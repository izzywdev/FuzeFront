/**
 * Relay sandbox: a private, throw-away copy of `event_outbox` for the outbox-relay delivery tests.
 *
 * WHY. `drainOutboxOnce` is a DATABASE-WIDE operation: it claims the head row of EVERY organization that has
 * pending rows (`FOR UPDATE ... SKIP LOCKED`) and hands each one to the injected `publish`. Run against the
 * shared `public.event_outbox` it is not isolated from anything else that touches that table:
 *
 *   - another drain of the same table (a second run of this suite, another worker, a relay loop on a service
 *     started with a broker) that holds an org's head row makes our pass SKIP the org, so a test that expects
 *     its own failing `publish` to run sees `retried: 0` and an untouched row; and
 *   - it works the other way round: our fakes pass every other test's rows through and mark them `sent`.
 *
 * So a test asserting "this org's row has `attempts` N after MY pass" was racing every other drainer on the
 * database. Nothing in the relay is wrong: SKIP LOCKED is exactly what makes concurrent relay instances safe.
 * The test was simply sharing the relay's work queue with strangers.
 *
 * WHAT. The sandbox creates a private schema holding an `event_outbox` with the SAME DDL as the real table
 * (`LIKE ... INCLUDING ALL`: columns, defaults, identity, CHECKs, the partial pending index) and a Knex handle
 * whose `search_path` puts that schema first. The relay's SQL uses the unqualified name `event_outbox`, so the
 * UNMODIFIED production relay runs against the private table; nothing else can lock, claim or sweep it.
 * Events are still produced by the real service over HTTP, into the real table. `adopt(orgId)` then COPIES that
 * org's rows into the sandbox, keeping every event column the service wrote (eventId, seq, topic, payload,
 * correlation id, created_at) and starting the DELIVERY columns (status, attempts, last_error, sent_at) at
 * their as-written values (`pending`, 0, NULL, NULL) so a foreign drain of the real table in the instant
 * between "service wrote it" and "sandbox adopted it" cannot change the starting state either.
 */
import { randomBytes } from 'crypto';
import { createRequire } from 'module';
import { db as serviceDb } from '../../../services/selection-list-service/dist/db';
import { dbQuery } from './db';

/** The Knex handle type the relay takes (`OutboxRelayOptions.db`). */
export type RelayDb = typeof serviceDb;

export interface OutboxStateRow {
  id: string;
  seq: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  last_error: string | null;
}

export interface RelaySandbox {
  /** Pass as `db` to `drainOutboxOnce`. Its `event_outbox` is the private copy. */
  db: RelayDb;
  /** Schema holding the private table (for diagnostics). */
  schema: string;
  /**
   * Copy every `public.event_outbox` row of `organizationId` into the sandbox, delivery state reset to as-written.
   * Returns the count. `seqStart` renumbers the copies `seqStart, seqStart+1, ...` (relative order preserved) so a
   * test can place an org's rows deterministically, e.g. straddling a power of ten (8, 9, 10).
   */
  adopt(organizationId: string, opts?: { seqStart?: number }): Promise<number>;
  /** Delivery state of one org's sandboxed rows, in `seq` order. */
  rows(organizationId: string): Promise<OutboxStateRow[]>;
  /** Drop the private schema and close the handle. */
  destroy(): Promise<void>;
}

export async function createRelaySandbox(): Promise<RelaySandbox> {
  // Hex only: the name is interpolated into DDL, never taken from outside.
  const schema = `relay_sbx_${process.pid}_${randomBytes(6).toString('hex')}`;

  // Build the handle with the SAME knex copy and config the service uses, plus a private search_path.
  const serviceRequire = createRequire(require.resolve('../../../services/selection-list-service/dist/db'));
  const makeKnex = serviceRequire('knex') as (config: object) => RelayDb;
  const config = (serviceDb.client as { config: Record<string, unknown> }).config;

  await dbQuery(`CREATE SCHEMA "${schema}"`);
  await dbQuery(`CREATE TABLE "${schema}".event_outbox (LIKE public.event_outbox INCLUDING ALL)`);
  const db = makeKnex({
    ...config,
    searchPath: [schema, 'public'],
    pool: { min: 0, max: 4 },
  });

  return {
    db,
    schema,
    async adopt(organizationId: string, opts: { seqStart?: number } = {}): Promise<number> {
      const seqStart = opts.seqStart === undefined ? null : Math.trunc(opts.seqStart);
      // COPY, never move: a plain read takes no row locks, so adoption cannot wait on (or deadlock with) a
      // foreign drain that is holding or locking the same rows - the test must not be able to flake on the
      // very thing it is isolating itself from. The originals stay in the shared table exactly like every
      // other test's rows do (without a broker nothing ever consumes them).
      const copied = await dbQuery<{ n: string }>(
        `WITH ins AS (
           INSERT INTO "${schema}".event_outbox
             (id, seq, organization_id, topic, payload, correlation_id, status, attempts, last_error, created_at, sent_at)
           OVERRIDING SYSTEM VALUE
           SELECT id,
                  CASE WHEN $2::bigint IS NULL THEN seq ELSE $2::bigint + row_number() OVER (ORDER BY seq) - 1 END,
                  organization_id, topic, payload, correlation_id, 'pending', 0, NULL, created_at, NULL
             FROM public.event_outbox WHERE organization_id = $1
           RETURNING 1
         )
         SELECT count(*)::text AS n FROM ins`,
        [organizationId, seqStart],
      );
      return Number(copied[0]?.n ?? 0);
    },
    async rows(organizationId: string): Promise<OutboxStateRow[]> {
      const res = await db.raw<{ rows: OutboxStateRow[] }>(
        // `seq` (BIGINT) is NOT cast: `SELECT seq::text AS seq ... ORDER BY seq` would sort by the TEXT output column
        // (output names win over input columns in ORDER BY), i.e. '10' < '4'. node-postgres hands BIGINT back as a
        // string already, so the numeric ORDER BY costs nothing.
        'SELECT id, seq, status, attempts, last_error FROM event_outbox WHERE organization_id = ? ORDER BY seq',
        [organizationId],
      );
      return res.rows;
    },
    async destroy(): Promise<void> {
      await db.destroy();
      await dbQuery(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    },
  };
}
