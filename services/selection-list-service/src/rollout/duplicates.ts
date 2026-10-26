// rollout/duplicates.ts - the pre-flag-ON duplicate audit (read-only) and its reconciliation
// (docs/runbooks/selection-lists-rollout.md sections 10.1 and 10.2).
//
// THE PROBLEM. `UNIQUE (organization_id, key)` compares the stored TEXT, but one organization has two renderings of
// its id (the bare UUID and the `org_...` TypeID), so data written before the service treated them as one org can
// hold the same key - or the same fork of one common list - once per rendering. With shared lists ON the service
// resolves such a pair deterministically at read time (lib/renderingWinner.ts: active, then the caller's own
// rendering, then oldest, then smallest id), so a duplicate is untidy, not wrong. This job makes the data match what
// the service already shows, BEFORE the flag is turned on, so that nothing a user sees changes.
//
// THE RULE (the same function the read path uses; not re-implemented): the winner is the ACTIVE row, then the OLDEST
// (`created_at`), then the smallest `id`. (The "caller's own rendering" criterion is neutral here: there is no
// caller, and after reconciliation only one row is left, so it cannot matter.) The winner is never touched. Every
// other row is the LOSER: it is RENAMED out of the way (`<key>--dup-<last 8 chars of its id>`) and ARCHIVED. It is
// never deleted: its id keeps resolving, its items, translations, grants and audit trail stay.
//
// TWO KINDS OF DUPLICATE (runbook queries A and B):
//   key   the same key held by one org under >1 stored rendering. Every non-winner is a loser.
//   fork  the same common list forked by one org under >1 stored rendering, where MORE THAN ONE of them is ACTIVE.
//         The winner is the oldest active fork; the other ACTIVE forks are losers. (An archived fork beside an
//         active one is not ambiguous - the service ignores the archived one - so it is not a finding.)
//   Phase order is key first, then fork, evaluated on the state the key phase leaves behind (a loser of the first
//   phase is archived, so it can no longer make a fork group ambiguous).
//
// PAIRING. Two stored ids are one organization iff their canonical `org_...` TypeIDs are equal (the identity codec;
// `canonicalOrgId`). That pairs organizations that are not in the org projection too (the runbook's SQL needs the
// projection for it; its query C lists the orgs it cannot pair). An id that is neither a UUID nor a TypeID cannot be
// paired with anything: it is reported as `unrecognised` and never touched.
//
// SAFETY WHILE THE SERVICE IS SERVING. Apply works one duplicate group per transaction: the organization outbox lock
// (the lock every writer takes) first, then the group's rows are RE-READ under it (`FOR NO KEY UPDATE`) and the
// winner/losers re-decided from that fresh state, then rename + archive + the `list.updated` / `list.archived` events
// through the outbox in the same transaction. A group another writer already cleaned is a no-op. A `platform`
// (common) list is NEVER auto-archived: archiving one changes the key lookup of every tenant; it is reported as
// BLOCKED for an operator.

import type { Knex } from 'knex';
import { emitListChanged, readList, systemEventContext } from '../events/emitters';
import { lockOrgOutbox } from '../events/outbox';
import { canonicalOrgId, orgRenderings } from '../lib/sharedLists';
import { rankRows } from '../lib/renderingWinner';
import { logger } from '../lib/logger';
import { refreshListUserModified } from '../seed/content';
import {
  correlationFor,
  emptyReport,
  finish,
  isEventRefusal,
  newRunId,
  type RolloutMode,
  type RolloutReport,
  type RolloutSkip,
  withReadOnly,
} from './common';

const log = logger.child({ component: 'selection-list-rollout', job: 'duplicates' });

/** The columns the audit needs; nothing else is ever loaded. */
export interface ListRef {
  id: string;
  organization_id: string;
  key: string;
  status: string;
  visibility: string;
  created_at: Date;
  forked_from_list_id: string | null;
}

export type DuplicateKind = 'key' | 'fork';

export interface DuplicateGroup {
  kind: DuplicateKind;
  /** The canonical `org_...` TypeID of the organization. */
  org: string;
  /** kind 'key': the shared key. */
  key?: string;
  /** kind 'fork': the common list that was forked more than once. */
  forkedFrom?: string;
  /** Every member, winner first (the runbook's `ids_winner_first`). */
  members: ListRef[];
  winner: ListRef;
  /** The rows to rename + archive. */
  losers: ListRef[];
}

// ---------------------------------------------------------------------------
// The rename (the runbook's fallback UPDATE spells the same expression in SQL)
// ---------------------------------------------------------------------------

export const DUP_SEPARATOR = '--dup-';
/** A key is at most 64 characters (contract `SelectionListKey`): leave room for the 6-char separator + 8-char tail. */
const DUP_BASE_MAX = 50;
const DUP_TAIL = 8;

/** `<key>--dup-<last 8 chars of the id>`, still a legal key (<= 64 chars): a long key is cut to 50 first. */
export function dupKey(key: string, id: string): string {
  const base = key.slice(0, DUP_BASE_MAX).replace(/-+$/, '');
  return `${base}${DUP_SEPARATOR}${id.slice(-DUP_TAIL)}`;
}

// ---------------------------------------------------------------------------
// Loading (keyset pages, so the memory is the lean columns only)
// ---------------------------------------------------------------------------

const PAGE = 5000;
const LEAN = ['id', 'organization_id', 'key', 'status', 'visibility', 'created_at', 'forked_from_list_id'] as const;

/** Every list, lean. Run it inside `withReadOnly` for one consistent snapshot. */
export async function loadAllLists(ex: Knex | Knex.Transaction): Promise<ListRef[]> {
  const out: ListRef[] = [];
  let after = '';
  for (;;) {
    const page: ListRef[] = await ex('selection_lists')
      .where('id', '>', after)
      .orderBy('id', 'asc')
      .limit(PAGE)
      .select(...LEAN);
    if (page.length === 0) break;
    out.push(...page);
    after = page[page.length - 1].id;
    if (page.length < PAGE) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pure grouping (unit-testable without a database)
// ---------------------------------------------------------------------------

/** Neutral claim: matches no stored id, so the "caller's own rendering" criterion ranks nobody. */
const NO_CLAIM = '';

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function groupBy<T>(rows: T[], keyOf: (r: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (k === null) continue;
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** Organizations whose stored id is neither a UUID nor a TypeID: they pair with nothing and are never touched. */
export function unrecognisedOrgs(rows: ListRef[]): string[] {
  return [...new Set(rows.filter((r) => canonicalOrgId(r.organization_id) === null).map((r) => r.organization_id))].sort(byText);
}

/** Query A: the same key under more than one stored rendering of one organization. */
export function findKeyGroups(rows: ListRef[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const byOrgKey = groupBy(rows, (r) => {
    const org = canonicalOrgId(r.organization_id);
    return org === null ? null : `${org}\u0000${r.key}`;
  });
  for (const members of byOrgKey.values()) {
    if (members.length < 2 || new Set(members.map((m) => m.organization_id)).size < 2) continue;
    const ranked = rankRows(members, NO_CLAIM);
    groups.push({
      kind: 'key',
      org: canonicalOrgId(members[0].organization_id) as string,
      key: members[0].key,
      members: ranked,
      winner: ranked[0],
      losers: ranked.slice(1),
    });
  }
  return groups.sort((a, b) => byText(a.org, b.org) || byText(a.key as string, b.key as string));
}

/** Query B: the same common list forked by one organization under >1 stored rendering, with >1 of them ACTIVE. */
export function findForkGroups(rows: ListRef[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const byOrgFork = groupBy(rows, (r) => {
    const org = canonicalOrgId(r.organization_id);
    return org === null || !r.forked_from_list_id ? null : `${org}\u0000${r.forked_from_list_id}`;
  });
  for (const members of byOrgFork.values()) {
    if (members.length < 2 || new Set(members.map((m) => m.organization_id)).size < 2) continue;
    if (members.filter((m) => m.status === 'active').length < 2) continue;
    const ranked = rankRows(members, NO_CLAIM);
    groups.push({
      kind: 'fork',
      org: canonicalOrgId(members[0].organization_id) as string,
      forkedFrom: members[0].forked_from_list_id as string,
      members: ranked,
      winner: ranked[0],
      losers: ranked.slice(1).filter((m) => m.status === 'active'),
    });
  }
  return groups.sort((a, b) => byText(a.org, b.org) || byText(a.forkedFrom as string, b.forkedFrom as string));
}

export interface PlannedLoser {
  group: DuplicateGroup;
  loser: ListRef;
  fromKey: string;
  toKey: string;
  wasActive: boolean;
  /** Set when the job must not touch it (a common list): reported BLOCKED. */
  blockedReason?: 'platform-list';
}

function planGroup(g: DuplicateGroup): PlannedLoser[] {
  return g.losers.map((loser) => ({
    group: g,
    loser,
    fromKey: loser.key,
    toKey: dupKey(loser.key, loser.id),
    wasActive: loser.status === 'active',
    blockedReason: loser.visibility === 'platform' ? ('platform-list' as const) : undefined,
  }));
}

/** The rows as they will be once the planned (not blocked) losers are renamed + archived. */
function simulate(rows: ListRef[], planned: PlannedLoser[]): ListRef[] {
  const changed = new Map(planned.filter((p) => !p.blockedReason).map((p) => [p.loser.id, p]));
  return rows.map((r) => {
    const p = changed.get(r.id);
    return p ? { ...r, key: p.toKey, status: 'archived' } : r;
  });
}

/** Everything a full reconcile would do, in order (key phase, then fork phase on the resulting state). */
export function planReconcile(rows: ListRef[]): { keyPhase: PlannedLoser[]; forkPhase: PlannedLoser[] } {
  const keyPhase = findKeyGroups(rows).flatMap(planGroup);
  const forkPhase = findForkGroups(simulate(rows, keyPhase)).flatMap(planGroup);
  return { keyPhase, forkPhase };
}

// ---------------------------------------------------------------------------
// The audit (read-only)
// ---------------------------------------------------------------------------

const groupDetail = (g: DuplicateGroup) => ({
  kind: g.kind,
  org: g.org,
  ...(g.kind === 'key' ? { key: g.key } : { forkedFrom: g.forkedFrom }),
  storedAs: g.members.map((m) => m.organization_id),
  idsWinnerFirst: g.members.map((m) => m.id),
  losers: g.losers.map((m) => m.id),
});

/**
 * The read-only audit: query A, query B and the unpairable organization ids (the runbook's C, minus the part the
 * codec makes unnecessary). Never writes; the CLI exits 2 when it finds a group.
 */
export async function runAudit(db: Knex, mode: RolloutMode = 'dry-run'): Promise<RolloutReport> {
  const report = emptyReport('audit', mode, newRunId());
  const rows = await withReadOnly(db, (trx) => loadAllLists(trx));
  const keyGroups = findKeyGroups(rows);
  const forkGroups = findForkGroups(rows);
  const unrecognised = unrecognisedOrgs(rows);
  report.summary = {
    lists: rows.length,
    keyDuplicateGroups: keyGroups.length,
    forkDuplicateGroups: forkGroups.length,
    unrecognisedOrgIds: unrecognised.length,
  };
  for (const g of [...keyGroups, ...forkGroups]) {
    report.blocked.push({ organizationId: g.org, reason: g.kind === 'key' ? 'duplicate-key' : 'duplicate-fork', detail: groupDetail(g) });
  }
  for (const o of unrecognised) {
    report.skipped.push({ organizationId: o, reason: 'unrecognised-org-id (neither a UUID nor a TypeID: cannot be paired, never touched)' });
  }
  return finish(report);
}

// ---------------------------------------------------------------------------
// The reconciliation
// ---------------------------------------------------------------------------

class RenameTargetTaken extends Error {
  constructor(readonly toKey: string) {
    super(`the rename target key ${toKey} is already taken`);
  }
}

type FreshScope = { kind: 'key'; key: string } | { kind: 'fork'; forkedFrom: string };

/**
 * Apply ONE duplicate group: under the organization outbox lock, re-read its rows, re-decide, rename + archive the
 * losers and enqueue their events. Returns what it did (empty when another writer already cleaned the group).
 */
async function applyGroup(db: Knex, g: DuplicateGroup, correlationId: string): Promise<PlannedLoser[]> {
  const stored = [...new Set([...g.members.map((m) => m.organization_id), ...orgRenderings(g.org)])];
  const scope: FreshScope = g.kind === 'key' ? { kind: 'key', key: g.key as string } : { kind: 'fork', forkedFrom: g.forkedFrom as string };
  return db.transaction(async (trx) => {
    await lockOrgOutbox(trx, g.org);
    const q = trx('selection_lists').whereIn('organization_id', stored);
    if (scope.kind === 'key') q.andWhere('key', scope.key);
    else q.andWhere('forked_from_list_id', scope.forkedFrom);
    const fresh: ListRef[] = await q.forNoKeyUpdate().select(...LEAN); // FOR NO KEY UPDATE keeps the rows still while we decide
    const again = (scope.kind === 'key' ? findKeyGroups(fresh) : findForkGroups(fresh))[0];
    if (!again) return [];
    const done: PlannedLoser[] = [];
    for (const p of planGroup(again)) {
      if (p.blockedReason) continue; // reported by the caller from the plan; never written
      const taken = await trx('selection_lists').whereIn('organization_id', stored).andWhere('key', p.toKey).whereNot('id', p.loser.id).first('id');
      if (taken) throw new RenameTargetTaken(p.toKey);
      const before = await readList(trx, p.loser.id);
      await trx('selection_lists').where({ id: p.loser.id }).update({ key: p.toKey, status: 'archived', updated_at: trx.fn.now() });
      // exactly what a PATCH does for any edit: persist whether a seeded list still hashes to its seed
      await refreshListUserModified(trx, p.loser.id);
      await emitListChanged(trx, systemEventContext(p.loser.organization_id, null, correlationId), p.loser.id, before);
      done.push(p);
    }
    return done;
  });
}

const changeOf = (p: PlannedLoser) => ({
  listId: p.loser.id,
  organizationId: p.loser.organization_id,
  action: `rename+archive (${p.group.kind} duplicate)`,
  detail: { org: p.group.org, from: p.fromKey, to: p.toKey, winner: p.group.winner.id, wasActive: p.wasActive },
});

/**
 * Reconcile the duplicate groups. `dry-run` (default) plans the whole thing in memory from one read-only snapshot and
 * writes nothing; `apply` does it group by group (see the header). Idempotent: once clean it finds nothing.
 */
export async function runReconcileDuplicates(db: Knex, mode: RolloutMode = 'dry-run'): Promise<RolloutReport> {
  const runId = newRunId();
  const report = emptyReport('reconcile-duplicates', mode, runId);
  const correlationId = correlationFor('reconcile-duplicates', runId);

  const snapshot = await withReadOnly(db, (trx) => loadAllLists(trx));
  const plan = planReconcile(snapshot);
  const blocked = new Map<string, RolloutSkip>(); // by list id: a list can be a blocked loser in both phases
  const block = (ps: PlannedLoser[]) => {
    for (const p of ps.filter((x) => x.blockedReason)) {
      blocked.set(p.loser.id, {
        listId: p.loser.id,
        organizationId: p.loser.organization_id,
        reason: 'would archive a common (platform) list: decide by hand (its key lookup serves every tenant)',
        detail: { org: p.group.org, key: p.fromKey, winner: p.group.winner.id },
      });
    }
  };
  let forkGroups = 0;

  if (mode === 'dry-run') {
    for (const p of [...plan.keyPhase, ...plan.forkPhase]) if (!p.blockedReason) report.changes.push(changeOf(p));
    block(plan.keyPhase);
    block(plan.forkPhase);
    forkGroups = new Set(plan.forkPhase.map((p) => `${p.group.org}|${p.group.forkedFrom}`)).size;
  } else {
    // One transaction per group; each group is re-read and re-decided under its organization lock.
    const applyPhase = async (groups: DuplicateGroup[]) => {
      for (const g of groups) {
        try {
          const done = await applyGroup(db, g, correlationId);
          for (const p of done) {
            report.changes.push(changeOf(p));
            log.info({ listId: p.loser.id, org: g.org, from: p.fromKey, to: p.toKey, runId }, 'duplicate list renamed and archived');
          }
        } catch (err) {
          if (err instanceof RenameTargetTaken) {
            report.blocked.push({ organizationId: g.org, reason: 'rename target key already taken: decide by hand', detail: { key: g.key, toKey: err.toKey } });
          } else if (isEventRefusal(err)) {
            // the group's transaction rolled back whole: nothing of it was written
            report.blocked.push({
              organizationId: g.org,
              reason: 'its event violates the event contract (legacy data, e.g. an invalid key): group left as it was, decide by hand',
              detail: { key: g.key, forkedFrom: g.forkedFrom, error: (err as Error).message.slice(0, 300) },
            });
          } else throw err;
        }
      }
    };
    await applyPhase(findKeyGroups(snapshot));
    block(plan.keyPhase);
    // The fork phase starts from the state the key phase left behind (a fresh snapshot).
    const after = await withReadOnly(db, (trx) => loadAllLists(trx));
    const forkPhase = planReconcile(after).forkPhase;
    forkGroups = new Set(forkPhase.map((p) => `${p.group.org}|${p.group.forkedFrom}`)).size;
    await applyPhase(findForkGroups(after));
    block(forkPhase);
  }

  report.blocked.push(...blocked.values());
  report.summary = {
    lists: snapshot.length,
    keyDuplicateGroups: findKeyGroups(snapshot).length,
    forkDuplicateGroups: forkGroups,
    [mode === 'dry-run' ? 'wouldRenameAndArchive' : 'renamedAndArchived']: report.changes.length,
    blocked: report.blocked.length,
  };
  for (const o of unrecognisedOrgs(snapshot)) report.skipped.push({ organizationId: o, reason: 'unrecognised-org-id (never touched)' });
  return finish(report);
}

