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
// ONE-SHOT PER ORGANIZATION, DURABLY. Before `fuzefront.selection-lists.shared-lists` is ON anywhere every seeded list is
// `private` (PATCH ignores `visibility` while the flag is OFF), so "private and seeded" means "never chosen by anyone". After
// the flag is ON for an org, an owner can deliberately set a seeded list back to `private`, and a later run of this job would
// re-publish it to every member of the org. So the job writes a MARKER per organization (`selection_list_rollout_marks`,
// migration 14) IN THE SAME TRANSACTION as the flips, under the organization outbox lock, and never touches a marked
// organization again: a re-run - however long after, whatever the outbox still remembers - leaves an owner's choice alone.
// Fail closed: a seeded list that appears in a marked organization later stays private (an operator can PATCH it); to run the
// job on purpose for an organization again, an operator clears its marker (runbook 10.4). Organizations with seeded lists but
// nothing to change are marked too. Second guard, best effort: a list with a `selection-lists.visibility.changed` event by a
// USER in the outbox is left alone (the outbox prunes delivered rows after OUTBOX_SENT_RETENTION_HOURS, 168 h by default,
// which is why it cannot be the only guard). The dry run reports marked organizations exactly as apply does.
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
import {
  correlationFor,
  emptyReport,
  finish,
  isEventRefusal,
  isOrgMarked,
  markedOrgs,
  markOrg,
  newRunId,
  REASON_EVENT_CONTRACT,
  REASON_ORG_DONE,
  type RolloutMode,
  type RolloutReport,
  snapshotRefusal,
  withReadOnly,
} from './common';

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

const JOB = 'visibility-org' as const;

/** `org_...` of a stored organization id, or null when it has none (a legacy id: its events cannot be written). */
function wireOf(stored: string): string | null {
  try {
    return wireOrgId(stored);
  } catch {
    return null;
  }
}

export async function runVisibilityOrg(db: Knex, mode: RolloutMode = 'dry-run'): Promise<RolloutReport> {
  const runId = newRunId();
  const report = emptyReport(JOB, mode, runId);
  const correlationId = correlationFor(JOB, runId);

  // The census, the markers and the candidates, from one consistent read-only snapshot (also what a dry run reports).
  const { census, candidates, chosen, refused, marked, seededOrgs } = await withReadOnly(db, async (trx) => {
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
    const orgs: string[] = await trx('selection_lists').whereNotNull('seed_source').distinct('organization_id').pluck('organization_id');
    return {
      census: c,
      candidates: cand,
      chosen: await humanChosen(trx, cand.map((x) => x.id)),
      refused: refusals,
      marked: await markedOrgs(trx, JOB),
      seededOrgs: new Set(orgs.map(wireOf).filter((o): o is string => o !== null)),
    };
  });

  const byOrg = new Map<string, Candidate[]>(); // by CANONICAL org id: one mark per organization, whichever rendering a list uses
  for (const c of candidates) {
    const wire = wireOf(c.organization_id);
    if (wire === null) {
      report.skipped.push({ listId: c.id, organizationId: c.organization_id, reason: 'unsupported-org-id (no org_ TypeID form: its events cannot be written): left alone' });
      continue;
    }
    if (marked.has(wire)) {
      // Fail closed: a DURABLE marker says this org was already processed, so a private seeded list here may be an owner's
      // deliberate choice. (The outbox cannot say: it prunes delivered rows after 168 h.)
      report.skipped.push({ listId: c.id, organizationId: c.organization_id, reason: REASON_ORG_DONE });
      continue;
    }
    if (chosen.has(c.id)) {
      report.skipped.push({ listId: c.id, organizationId: c.organization_id, reason: 'a user set this list private on purpose (visibility.changed by a user): left alone' });
      continue;
    }
    if (refused.has(c.id)) {
      report.blocked.push({ listId: c.id, organizationId: c.organization_id, reason: REASON_EVENT_CONTRACT, detail: { key: c.key, error: refused.get(c.id) } });
      continue;
    }
    const arr = byOrg.get(wire);
    if (arr) arr.push(c);
    else byOrg.set(wire, [c]);
  }

  if (mode === 'dry-run') {
    for (const list of [...byOrg.values()].flat()) {
      report.changes.push({ listId: list.id, organizationId: list.organization_id, action: 'visibility private -> org', detail: { key: list.key } });
    }
  } else {
    let orgChanged = 0; // lists changed so far in the organization being processed (the marker records it)
    /**
     * One transaction: the organization outbox lock, the marker re-checked under it, the candidates re-read, the flips, their
     * events and (on the organization's final call) the MARKER, all committed together or not at all.
     */
    const convert = (wire: string, chunk: Candidate[], final: boolean): Promise<Candidate[] | 'org-done'> =>
      db.transaction(async (trx) => {
        await lockOrgOutbox(trx, wire);
        if (await isOrgMarked(trx, JOB, wire)) return 'org-done'; // another run finished it meanwhile
        // Re-read under the lock: only what is STILL private and seeded, and still not a user's choice.
        const fresh: Candidate[] = await trx('selection_lists')
          .whereIn('id', chunk.map((c) => c.id))
          .whereNotNull('seed_source')
          .andWhere('visibility', 'private')
          .forNoKeyUpdate()
          .select('id', 'organization_id', 'key');
        const keep = await humanChosen(trx, fresh.map((f) => f.id));
        const todo = fresh.filter((f) => !keep.has(f.id));
        if (todo.length > 0) {
          await trx('selection_lists')
            .whereIn('id', todo.map((t) => t.id))
            .update({ visibility: 'org', updated_at: trx.fn.now() });
          const ctx = systemEventContext(wire, null, correlationId);
          for (const t of todo) await emitVisibilityChanged(trx, ctx, t.id, 'private');
        }
        if (final) await markOrg(trx, JOB, wire, runId, orgChanged + todo.length);
        return todo;
      });
    /**
     * A list whose event the contract refuses fails its whole transaction, so a failing chunk is retried list by list: only
     * the offending list is BLOCKED (reported, unchanged), the rest convert.
     */
    const convertIsolating = async (wire: string, chunk: Candidate[], final: boolean): Promise<Candidate[]> => {
      try {
        const r = await convert(wire, chunk, final);
        if (r === 'org-done') {
          for (const c of chunk) report.skipped.push({ listId: c.id, organizationId: c.organization_id, reason: REASON_ORG_DONE });
          return [];
        }
        orgChanged += r.length;
        return r;
      } catch (err) {
        if (!isEventRefusal(err)) throw err;
        if (chunk.length > 1) {
          const done: Candidate[] = [];
          for (const [i, one] of chunk.entries()) done.push(...(await convertIsolating(wire, [one], final && i === chunk.length - 1)));
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
    /** The marker for an organization whose final chunk could not carry it (nothing to change, or a blocked last list). */
    const ensureMarked = (wire: string, changed: number): Promise<void> =>
      db.transaction(async (trx) => {
        await lockOrgOutbox(trx, wire);
        await markOrg(trx, JOB, wire, runId, changed);
      });
    for (const [wire, lists] of byOrg) {
      orgChanged = 0;
      for (let i = 0; i < lists.length; i += VISIBILITY_CHUNK) {
        const done = await convertIsolating(wire, lists.slice(i, i + VISIBILITY_CHUNK), i + VISIBILITY_CHUNK >= lists.length);
        for (const t of done) {
          report.changes.push({ listId: t.id, organizationId: t.organization_id, action: 'visibility private -> org', detail: { key: t.key } });
          log.info({ listId: t.id, orgId: wire, runId }, 'seeded list made org-readable');
        }
      }
      await ensureMarked(wire, orgChanged);
    }
    // Organizations with seeded lists but nothing to change (all org already, or only left-alone / blocked lists) are
    // marked as well: that is the population this job concerns, and a list there that is private later is a choice.
    for (const wire of seededOrgs) if (!marked.has(wire) && !byOrg.has(wire)) await ensureMarked(wire, 0);
  }

  const n = (v: string) => Number(census.find((c) => c.visibility === v)?.n ?? 0);
  report.summary = {
    seededListsTotal: census.reduce((a, c) => a + Number(c.n), 0),
    seededPrivateAtStart: candidates.length,
    seededOrgAtStart: n('org'),
    seededPlatformAtStart: n('platform'),
    orgsAlreadyMarked: marked.size,
    [mode === 'dry-run' ? 'wouldChange' : 'changed']: report.changes.length,
    leftAlone: report.skipped.length,
  };
  return finish(report);
}
