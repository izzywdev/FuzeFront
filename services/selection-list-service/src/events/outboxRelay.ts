// events/outboxRelay.ts — the per-organization ORDERED outbox relay for
// selection-list-service (docs/planning/selection-lists-events.md section 6, Q6).
//
// Semantics copied from backend/core/src/events/outboxRelay.ts (poll `pending`
// rows, claim with FOR UPDATE SKIP LOCKED, publish inside the claiming
// transaction, bounded attempts then park + DLQ) with the ONE change section 6
// step 4 requires and the core relay does not have: an organization's later
// event is NEVER published while an earlier event of the same organization is
// still pending retry.
//
// How the ordering is enforced
//   * The CLAIM is per organization, not per row. Each pass selects the HEAD
//     row (lowest `seq`) of every organization that has pending rows and locks
//     it FOR UPDATE SKIP LOCKED. Another relay instance that sees the same head
//     locked skips that organization entirely, so it can never pick up row N+1
//     of an org whose row N we are working on (a plain per-row SKIP LOCKED would
//     do exactly that and reorder).
//   * Having claimed an org we publish its pending rows in `seq` order and STOP
//     at the first failure (the row's `attempts` is incremented and it stays
//     `pending`); the remaining rows of that org wait for the next pass. Other
//     orgs in the same pass are unaffected - head-of-line blocking is per org.
//   * Writers serialise per org up to COMMIT (events/outbox.ts lockOrgOutbox), so
//     `seq` order is commit order and "lowest pending seq" is truly the oldest.
//
// Failure policy
//   * publish failure          -> attempts + 1, stay pending, org stops this pass.
//                                 After `maxAttempts` (10) the row is PARKED.
//   * schema-invalid payload   -> parked immediately (a bug, retrying cannot help;
//                                 the writer validates, so this means schema drift).
//   * PARKED = copied to `<topic>.dlq` (via `deadLetter`) and marked `failed`.
//     A parked row no longer blocks its org: the org continues with later rows
//     (consumers gate on listRevision, so a gap is detectable). If the DLQ copy
//     itself FAILS the row is NOT marked failed (that would lose the event): it
//     stays pending with attempts >= max, the org stops, and the next pass goes
//     straight to retrying the DLQ copy.
//   * delivery is AT-LEAST-ONCE: a crash after publish but before the row is
//     marked sent re-publishes it with the same eventId (the idempotency key).
//
// Fail-safe: `startOutboxRelay` never throws and never lets a pass reject; a DB
// or Kafka outage is logged, counted, and retried with exponential backoff. It
// cannot take the HTTP server down.

import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { SafeParseError } from 'zod';
import { schemaForTopic } from '@fuzefront/shared/kafka';
import { logger as rootLogger } from '../lib/logger';
import {
  outboxFailedGauge,
  outboxOldestPendingAgeGauge,
  outboxParkedTotal,
  outboxPendingGauge,
  outboxPublishedTotal,
  outboxPublishFailuresTotal,
} from '../lib/metrics';

/** One decoded outbox row handed to the publisher. */
export interface OutboxRecord {
  /** The eventId (UUIDv7) - also the row id. */
  id: string;
  /** Strict insertion order; BIGINT arrives as a string from pg. */
  seq: string;
  organizationId: string;
  topic: string;
  payload: unknown;
  correlationId: string;
  /** Publish attempts already made (not counting the one about to run). */
  attempts: number;
  /** When the change was committed to the outbox (the envelope's occurredAt). */
  createdAt: Date;
}

/** Publishes one record to the bus. Throw to signal a retryable failure. */
export type OutboxPublish = (record: OutboxRecord) => Promise<void>;
/** Copies a record to `<topic>.dlq`. Throw if the copy could not be made. */
export type OutboxDeadLetter = (record: OutboxRecord, reason: string) => Promise<void>;

export type ParkReason = 'max_attempts' | 'schema_invalid';

export interface OutboxRelayOptions {
  db: Knex;
  publish: OutboxPublish;
  deadLetter: OutboxDeadLetter;
  /** Max rows published per org per pass. Default 50. */
  batchSize?: number;
  /** Max organizations claimed per pass. Default 25. */
  maxOrgsPerPass?: number;
  /** Publish attempts before a row is parked. Default 10 (plan section 6). */
  maxAttempts?: number;
  /** Checked between rows so a long batch stops promptly on shutdown. */
  shouldStop?: () => boolean;
  logger?: Logger;
}

export interface DrainResult {
  /** Rows published and marked sent. */
  sent: number;
  /** Publish failures (row left pending for retry). */
  retried: number;
  /** Rows parked as failed + dead-lettered. */
  parked: number;
  /** DLQ copies that failed (row left pending). */
  deadLetterFailed: number;
  /** Organizations claimed this pass. */
  orgs: number;
  /** Claim hit its org cap, so more work is probably waiting. */
  more: boolean;
}

interface Head {
  organization_id: string;
}

interface Row {
  id: string;
  seq: string;
  organization_id: string;
  topic: string;
  payload: unknown;
  correlation_id: string;
  attempts: number;
  created_at: Date;
}

function toRecord(row: Row): OutboxRecord {
  return {
    id: row.id,
    seq: String(row.seq),
    organizationId: row.organization_id,
    topic: row.topic,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    correlationId: row.correlation_id,
    attempts: row.attempts,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}

/** null when the payload satisfies its topic schema, else a short reason. */
function payloadProblem(record: OutboxRecord): string | null {
  const schema = schemaForTopic(record.topic);
  if (!schema) return `no schema registered for ${record.topic}`;
  const check = schema.safeParse(record.payload);
  if (check.success) return null;
  const failure = check as SafeParseError<unknown>; // (strict:false disables union narrowing)
  return `payload invalid: ${failure.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`.slice(0, 1000);
}

const errMessage = (err: unknown): string => String((err as Error)?.message ?? err).slice(0, 1000);

/**
 * One claim-and-publish pass. Everything for the claimed orgs happens in ONE
 * transaction, so the head-row locks (the cross-instance mutual exclusion) are
 * held until every row is marked and the pass commits.
 */
export async function drainOutboxOnce(opts: OutboxRelayOptions): Promise<DrainResult> {
  const { db, publish, deadLetter } = opts;
  const batchSize = opts.batchSize ?? 50;
  const maxOrgs = opts.maxOrgsPerPass ?? 25;
  const maxAttempts = opts.maxAttempts ?? 10;
  const log = opts.logger ?? rootLogger;
  const stopping = opts.shouldStop ?? (() => false);
  const result: DrainResult = { sent: 0, retried: 0, parked: 0, deadLetterFailed: 0, orgs: 0, more: false };

  await db.transaction(async (trx) => {
    // Head row (lowest seq) per org that has pending rows, locked SKIP LOCKED.
    // A head locked by another relay instance excludes that whole org from us.
    const heads = await trx.raw<{ rows: Head[] }>(
      `SELECT e.organization_id
         FROM event_outbox e
        WHERE e.status = 'pending'
          AND e.id IN (
            SELECT DISTINCT ON (organization_id) id
              FROM event_outbox
             WHERE status = 'pending'
             ORDER BY organization_id, seq
          )
        ORDER BY e.seq
        LIMIT ?
          FOR UPDATE OF e SKIP LOCKED`,
      [maxOrgs],
    );
    result.orgs = heads.rows.length;
    result.more = heads.rows.length >= maxOrgs;

    for (const head of heads.rows) {
      if (stopping()) break;
      const rows = await trx.raw<{ rows: Row[] }>(
        `SELECT id, seq, organization_id, topic, payload, correlation_id, attempts, created_at
           FROM event_outbox
          WHERE organization_id = ? AND status = 'pending'
          ORDER BY seq
          LIMIT ?
            FOR UPDATE`,
        [head.organization_id, batchSize],
      );

      for (const row of rows.rows) {
        if (stopping()) break;
        const record = toRecord(row);
        const rlog = log.child({
          component: 'outbox-relay',
          reqId: record.correlationId,
          eventId: record.id,
          topic: record.topic,
          orgId: record.organizationId,
        });

        // 1. A row whose DLQ copy failed earlier is already at the cap: do not
        //    publish it again, just retry the park.
        let parkReason: ParkReason | null = record.attempts >= maxAttempts ? 'max_attempts' : null;
        let lastError: string | null = null;
        let attempts = record.attempts;

        // 2. Schema drift is a bug: park at once.
        if (!parkReason) {
          const invalid = payloadProblem(record);
          if (invalid) {
            parkReason = 'schema_invalid';
            lastError = invalid;
            attempts += 1;
          }
        }

        // 3. Publish.
        if (!parkReason) {
          const started = performance.now();
          try {
            await publish(record);
            await trx('event_outbox')
              .where('id', record.id)
              .update({ status: 'sent', attempts: attempts + 1, sent_at: trx.fn.now(), last_error: null });
            outboxPublishedTotal.inc({ topic: record.topic });
            result.sent += 1;
            rlog.debug({ op: 'outbox.publish', elapsedMs: Math.round(performance.now() - started) }, 'outbox event published');
            continue;
          } catch (err) {
            attempts += 1;
            lastError = errMessage(err);
            outboxPublishFailuresTotal.inc({ topic: record.topic });
            if (attempts < maxAttempts) {
              await trx('event_outbox').where('id', record.id).update({ attempts, last_error: lastError });
              result.retried += 1;
              rlog.warn({ op: 'outbox.publish', attempts, maxAttempts, err }, 'outbox publish failed; will retry (org blocked until it succeeds)');
              // HEAD-OF-LINE: never publish a later event of this org past a pending one.
              break;
            }
            parkReason = 'max_attempts';
            rlog.error({ op: 'outbox.publish', attempts, maxAttempts, err }, 'outbox publish failed; attempts exhausted');
          }
        }

        // 4. Park: copy to <topic>.dlq, then mark failed. DLQ failure keeps the row pending.
        try {
          await deadLetter(record, `${parkReason}: ${lastError ?? 'attempts exhausted'}`);
        } catch (dlqErr) {
          await trx('event_outbox')
            .where('id', record.id)
            .update({ attempts, last_error: `dlq copy failed: ${errMessage(dlqErr)}` });
          result.deadLetterFailed += 1;
          rlog.error({ op: 'outbox.dlq', err: dlqErr }, 'outbox DLQ copy failed; row stays pending (org blocked)');
          break;
        }
        await trx('event_outbox')
          .where('id', record.id)
          .update({ status: 'failed', attempts, last_error: lastError });
        outboxParkedTotal.inc({ topic: record.topic, reason: parkReason });
        result.parked += 1;
        rlog.error({ op: 'outbox.park', reason: parkReason, attempts }, 'outbox event parked and dead-lettered');
        // A parked row no longer blocks its org: continue with the next row.
      }
    }
  });

  return result;
}

/** Refresh the outbox gauges (cheap, index-backed). Never throws. */
export async function refreshOutboxGauges(db: Knex, log: Logger = rootLogger): Promise<void> {
  try {
    const pending = await db.raw<{ rows: Array<{ n: string; age: string | null }> }>(
      `SELECT count(*) AS n, EXTRACT(EPOCH FROM (now() - min(created_at))) AS age
         FROM event_outbox WHERE status = 'pending'`,
    );
    const failed = await db.raw<{ rows: Array<{ n: string }> }>(`SELECT count(*) AS n FROM event_outbox WHERE status = 'failed'`);
    outboxPendingGauge.set(Number(pending.rows[0]?.n ?? 0));
    outboxOldestPendingAgeGauge.set(Number(pending.rows[0]?.age ?? 0));
    outboxFailedGauge.set(Number(failed.rows[0]?.n ?? 0));
  } catch (err) {
    log.warn({ err, op: 'outbox.gauges' }, 'outbox gauge refresh failed');
  }
}

/** Delete `sent` rows older than `hours` (bounded batch). Returns rows deleted. */
export async function pruneSentOutbox(db: Knex, hours: number, limit = 1000): Promise<number> {
  const res = await db.raw(
    `DELETE FROM event_outbox
      WHERE id IN (
        SELECT id FROM event_outbox
         WHERE status = 'sent' AND sent_at < now() - make_interval(hours => ?)
         LIMIT ?
      )`,
    [hours, limit],
  );
  return Number((res as { rowCount?: number }).rowCount ?? 0);
}

export interface OutboxRelayHandle {
  /** Stop scheduling, let the in-flight pass finish its current row, resolve when idle. */
  stop(): Promise<void>;
}

export interface StartOutboxRelayOptions extends OutboxRelayOptions {
  /** Poll interval when idle, and the base retry delay. Default 1000ms. */
  intervalMs?: number;
  /** Ceiling for the failure backoff. Default 30000ms. */
  maxBackoffMs?: number;
  /** Sent rows older than this are pruned (checked every ~minute). 0 disables. Default 168h. */
  sentRetentionHours?: number;
}

/**
 * Start the background relay. Returns a handle whose `stop()` is safe to call
 * from the shutdown path. Never throws; every failure is contained and logged.
 */
export function startOutboxRelay(opts: StartOutboxRelayOptions): OutboxRelayHandle {
  const log = opts.logger ?? rootLogger;
  const intervalMs = opts.intervalMs ?? 1000;
  const maxBackoffMs = opts.maxBackoffMs ?? 30_000;
  const retentionHours = opts.sentRetentionHours ?? 168;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> = Promise.resolve();
  let failures = 0;
  let lastPrune = 0;

  const pass = async (): Promise<number> => {
    let delay = intervalMs;
    try {
      const r = await drainOutboxOnce({ ...opts, logger: log, shouldStop: () => stopped || (opts.shouldStop?.() ?? false) });
      const trouble = r.retried > 0 || r.deadLetterFailed > 0;
      failures = trouble ? failures + 1 : 0;
      if (trouble) delay = Math.min(maxBackoffMs, intervalMs * 2 ** Math.min(failures, 10));
      else if (r.sent > 0 || r.parked > 0 || r.more) delay = 0; // more may be waiting: go again at once
      if (r.sent || r.retried || r.parked) log.info({ ...r, component: 'outbox-relay' }, 'outbox relay pass');
      await refreshOutboxGauges(opts.db, log);
      if (retentionHours > 0 && Date.now() - lastPrune > 60_000) {
        lastPrune = Date.now();
        const pruned = await pruneSentOutbox(opts.db, retentionHours);
        if (pruned > 0) log.info({ pruned, component: 'outbox-relay' }, 'pruned delivered outbox rows');
      }
    } catch (err) {
      // DB down, pool exhausted, ...: contained here; retried with backoff.
      failures += 1;
      delay = Math.min(maxBackoffMs, intervalMs * 2 ** Math.min(failures, 10));
      log.error({ err, component: 'outbox-relay', op: 'outbox.drain' }, 'outbox relay pass failed (will retry)');
    }
    return delay;
  };

  const schedule = (delay: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      inflight = pass().then(schedule, () => schedule(intervalMs));
    }, delay);
    // The relay must never keep the process alive on its own.
    timer.unref?.();
  };

  schedule(intervalMs);

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await inflight.catch(() => undefined);
    },
  };
}
