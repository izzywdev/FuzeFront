// rollout/visibilityOrg.ts - design record section 9.4: make every SEEDED list readable by the members of its own
// organization (`visibility = 'org'`), so the "seeded lists are invisible" gap closes without common lists.
//
//   private --> org   for every list with `seed_source IS NOT NULL` that is still `private`.
//
// Nobody gains a write: `visibility` widens READING only (D1); every mutation stays behind the five instance roles.
//
// FLAG-INDEPENDENT and IDEMPOTENT. It reads and writes data, never the release flag, and the WHERE clause is the whole
// state machine: once a list is `org` the job has nothing to do for it, so a re-run is a no-op.
//
// ONE RUN BEFORE THE FLAG, NOT A CONVERGENCE LOOP FOREVER. Before `fuzefront.selection-lists.shared-lists` is ON anywhere
// every seeded list is `private` (PATCH ignores `visibility` while the flag is OFF), so "private and seeded" means "never
// chosen by anyone". After the flag is ON for an org, an owner can deliberately set a seeded list back to `private`, and a
// later run of this job would undo that choice. Two guards: (1) the dry run names every list it would change, so review
// it; (2) a list that has a `selection-lists.visibility.changed` event whose actor is a USER is left alone (best effort:
// the outbox keeps delivered rows for OUTBOX_SENT_RETENTION_HOURS, 168 h by default).
//
// EVENTS. Each change enqueues `selection-lists.visibility.changed` (previous `private`, now `org`) through the outbox in
// the SAME transaction, with the service as actor, so projections and the BFF read model learn it. Per organization: the
// organization outbox lock first (the lock every writer of the service takes), the candidates re-read under it, then the
// updates, in chunks so a lock is never held for long.

import type { Knex } from 'knex';
import { TOPICS } from '@fuzefront/shared/kafka';
import { emitVisibilityChanged, systemEventContext } from '../events/emitters';
import { lockOrgOutbox, wireOrgId } from '../events/outbox';
import { logger } from '../lib/logger';
import { correlationFor, emptyReport, finish, isEventRefusal, newRunId, REASON_EVENT_CONTRACT, type RolloutMode, type RolloutReport, snapshotRefusal, withReadOnly } from './common';

const log = logger.child({ component: 'selection-list-rollout', job: 'visibility-org' });

/** Lists per transaction: bounds how long one organization's outbox lock is held. */
export const VISIBILITY_CHUNK = 200;

interface Candidate {
  id: string;
  organization_id: string;
  key: string;
}

/** Of `ids`, the lists a USER changed the visibility of (best effort, see the header). */
async function humanChosen(ex: Knex | Knex.Transaction, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const res = await ex.raw(
    `SELECT DISTINCT payload->>'listId' AS id
       FROM event_outbox
      WHERE topic = ? AND payload #>> '{actor,type}' = 'user' AND payload->>'listId' = ANY(?)`,
    [TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED, ids],
  );
  return new Set(((res as { rows?: Array<{ id: string }> }).rows ?? []).map((r) => r.id));
}

const CANDIDATES = (ex: Knex | Knex.Transaction) =>
  ex('selection_lists').whereNotNull('seed_source').andWhere('visibility', 'private').select<Candidate[]>('id', 'organization_id', 'key');

export async function runVisibilityOrg(db: Knex, mode: RolloutMode = 'dry-run'): Promise<RolloutReport> {
  const runId = newRunId();
  const report = emptyReport('visibility-org', mode, runId);
  const correlationId = correlationFor('visibility-org', runId);

  // The census and the candidates, from one consistent read-only snapshot (also what a dry run reports).
  const { census, candidates, chosen, refused } = await withReadOnly(db, async (trx) => {
    const c: Array<{ visibility: string; n: string }> = (
      await trx.raw(`SELECT visibility, count(*)::text AS n FROM selection_lists WHERE seed_source IS NOT NULL GROUP BY visibility`)
    ).rows;
    const cand = await CANDIDATES(trx).orderBy([{ column: 'organization_id' }, { column: 'id' }]);
    // Would the visibility.changed event of each candidate be refused by the contract? Asked HERE, in both modes, so the
    // dry run reports exactly what apply will do (apply would otherwise find out by a rolled-back transaction).
    const refusals = new Map<string, string>();
    for (const x of cand) {
      const why = await snapshotRefusal(trx, x.id, { visibility: 'org' });
      if (why) refusals.set(x.id, why);
    }
    return { census: c, candidates: cand, chosen: await humanChosen(trx, cand.map((x) => x.id)), refused: refusals };
  });

  const byOrg = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (chosen.has(c.id)) {
      report.skipped.push({ listId: c.id, organizationId: c.organization_id, reason: 'a user set this list private on purpose (visibility.changed by a user): left alone' });
      continue;
    }
    try {
      wireOrgId(c.organization_id); // the event needs a wire id; a legacy id that has none cannot be announced
    } catch {
      report.skipped.push({ listId: c.id, organizationId: c.organization_id, reason: 'unsupported-org-id (no org_ TypeID form: its events cannot be written): left alone' });
      continue;
    }
    if (refused.has(c.id)) {
      report.blocked.push({ listId: c.id, organizationId: c.organization_id, reason: REASON_EVENT_CONTRACT, detail: { key: c.key, error: refused.get(c.id) } });
      continue;
    }
    const arr = byOrg.get(c.organization_id);
    if (arr) arr.push(c);
    else byOrg.set(c.organization_id, [c]);
  }

  if (mode === 'dry-run') {
    for (const list of [...byOrg.values()].flat()) {
      report.changes.push({ listId: list.id, organizationId: list.organization_id, action: 'visibility private -> org', detail: { key: list.key } });
    }
  } else {
    const convert = (orgId: string, chunk: Candidate[]): Promise<Candidate[]> =>
      db.transaction(async (trx) => {
        await lockOrgOutbox(trx, orgId);
        // Re-read under the lock: only what is STILL private and seeded, and still not a user's choice.
        const fresh: Candidate[] = await trx('selection_lists')
          .whereIn('id', chunk.map((c) => c.id))
          .whereNotNull('seed_source')
          .andWhere('visibility', 'private')
          .forNoKeyUpdate()
          .select('id', 'organization_id', 'key');
        const keep = await humanChosen(trx, fresh.map((f) => f.id));
        const todo = fresh.filter((f) => !keep.has(f.id));
        if (todo.length === 0) return [];
        await trx('selection_lists')
          .whereIn('id', todo.map((t) => t.id))
          .update({ visibility: 'org', updated_at: trx.fn.now() });
        const ctx = systemEventContext(orgId, null, correlationId);
        for (const t of todo) await emitVisibilityChanged(trx, ctx, t.id, 'private');
        return todo;
      });
    /**
     * A list whose event the contract refuses (legacy data, e.g. a one-character key) fails its whole transaction, so a
     * failing chunk is retried list by list: only the offending list is BLOCKED (reported, unchanged), the rest convert.
     */
    const convertIsolating = async (orgId: string, chunk: Candidate[]): Promise<Candidate[]> => {
      try {
        return await convert(orgId, chunk);
      } catch (err) {
        if (!isEventRefusal(err)) throw err;
        if (chunk.length > 1) {
          const done: Candidate[] = [];
          for (const one of chunk) done.push(...(await convertIsolating(orgId, [one])));
          return done;
        }
        report.blocked.push({
          listId: chunk[0].id,
          organizationId: chunk[0].organization_id,
          reason: REASON_EVENT_CONTRACT,
          detail: { key: chunk[0].key, error: (err as Error).message.slice(0, 300) },
        });
        return [];
      }
    };
    for (const [orgId, lists] of byOrg) {
      for (let i = 0; i < lists.length; i += VISIBILITY_CHUNK) {
        const done = await convertIsolating(orgId, lists.slice(i, i + VISIBILITY_CHUNK));
        for (const t of done) {
          report.changes.push({ listId: t.id, organizationId: t.organization_id, action: 'visibility private -> org', detail: { key: t.key } });
          log.info({ listId: t.id, orgId: orgId, runId }, 'seeded list made org-readable');
        }
      }
    }
  }

  const n = (v: string) => Number(census.find((c) => c.visibility === v)?.n ?? 0);
  report.summary = {
    seededListsTotal: census.reduce((a, c) => a + Number(c.n), 0),
    seededPrivateAtStart: candidates.length,
    seededOrgAtStart: n('org'),
    seededPlatformAtStart: n('platform'),
    [mode === 'dry-run' ? 'wouldChange' : 'changed']: report.changes.length,
    leftAlone: report.skipped.length,
  };
  return finish(report);
}
