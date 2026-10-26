// rollout/retroForks.ts - design record section 9.6: the existing per-organization copies of the platform pack lists
// become FORKS of the common lists that now exist.
//
//   For a common list C (visibility `platform`, owned by the platform organization, active) and an organization copy L
//   (seeded by the platform pack, in another organization, same key, not yet a fork):
//     L.forked_from_list_id / _org_id / _revision / _at  := C's id / owner / current revision / now
//     L.items.origin_item_id                              := the C item with the same `code` (codes are immutable and
//                                                            list-unique, so the mapping is exact)
//   L keeps its id, its items, its edits and its visibility, and keeps shadowing C for its organization (precedence is
//   unchanged for its users). The service's resolve redirect (D9) then maps a stored common item id to L's item.
//
// WHICH COPIES. Matched by SEED PROVENANCE, never by guessing: `seed_source = 'platform'` and, when the common list was
// itself seeded, the same `seed_key` and `seed_list_key`; AND the SAME current `key` (the `list.forked` contract says a
// fork keeps its source's key, so a copy a user renamed cannot be announced as a fork and is reported, not converted). A
// list a user authored by hand with the same key is not a copy of the pack list and is never touched.
//
// WHAT IS LEFT ALONE (reported with a reason): a copy that is already a fork; an organization that holds the copy under
// both renderings of its id (only the winner of the shared winner rule is converted; reconcile the duplicates first,
// which `--apply` insists on); an organization whose stored id has no `org_` TypeID form (its event cannot be written);
// a renamed copy; a copy with more than 5000 mappable items (the `list.forked` bound).
//
// FLAG-INDEPENDENT, IDEMPOTENT, SAFE WHILE SERVING. Per copy, one transaction: the organization outbox lock, the copy and
// its source re-read under it (the source `FOR SHARE`, like the fork endpoint), the update, and a synthetic
// `selection-lists.list.forked` (the actor is the service) through the outbox in the SAME transaction. Once converted a
// copy has `forked_from_list_id`, so a re-run finds nothing. It needs SELECTION_LIST_PLATFORM_ORG_ID (read like the
// service reads it; the org projection must confirm it) because "the common list" is defined by that organization.

import type { Knex } from 'knex';
import { SELECTION_LIST_MAX_FORK_ITEMS } from '@fuzefront/shared/kafka';
import { emitListForkedRetroactive, systemEventContext } from '../events/emitters';
import { lockOrgOutbox, wireOrgId } from '../events/outbox';
import { rankRows } from '../lib/renderingWinner';
import { logger } from '../lib/logger';
import { canonicalOrgId, orgForms, orgRenderings, resolvePlatformOrgId } from '../lib/sharedLists';
import { DUP_SEPARATOR, findForkGroups, findKeyGroups, loadAllLists } from './duplicates';
import {
  correlationFor,
  emptyReport,
  finish,
  isEventRefusal,
  newRunId,
  RolloutPreconditionError,
  type RolloutChange,
  type RolloutMode,
  type RolloutReport,
  withReadOnly,
} from './common';

const log = logger.child({ component: 'selection-list-rollout', job: 'retro-forks' });

const NO_CLAIM = '';

interface CommonRow {
  id: string;
  organization_id: string;
  key: string;
  status: string;
  visibility: string;
  created_at: Date;
  revision: string | number;
  seed_key: string | null;
  seed_list_key: string | null;
}

interface CopyRow {
  id: string;
  organization_id: string;
  key: string;
  status: string;
  visibility: string;
  created_at: Date;
  seed_key: string | null;
  seed_list_key: string | null;
}

interface PlannedFork {
  copy: CopyRow;
  common: CommonRow;
  org: string;
}

const COMMON_COLS = ['id', 'organization_id', 'key', 'status', 'visibility', 'created_at', 'revision', 'seed_key', 'seed_list_key'] as const;
const COPY_COLS = ['id', 'organization_id', 'key', 'status', 'visibility', 'created_at', 'seed_key', 'seed_list_key'] as const;

/** Chunk for `= ANY(?)` id lists. */
const IN_CHUNK = 1000;

interface Plan {
  platformOrg: string;
  planned: PlannedFork[];
  skipped: RolloutReport['skipped'];
  warnings: string[];
  commonCount: number;
}

async function plan(ex: Knex | Knex.Transaction): Promise<Plan> {
  const platformOrg = await resolvePlatformOrgId(ex);
  if (!platformOrg) {
    throw new RolloutPreconditionError(
      'the platform organization is not resolved: SELECTION_LIST_PLATFORM_ORG_ID must be set to its org_ TypeID and the org projection must show it as an active organization of type platform',
    );
  }
  const platformForms = orgForms(platformOrg);
  const out: Plan = { platformOrg, planned: [], skipped: [], warnings: [], commonCount: 0 };

  const commonRows: CommonRow[] = await ex('selection_lists')
    .where({ visibility: 'platform', status: 'active' })
    .whereIn('organization_id', platformForms)
    .select(...COMMON_COLS);
  // ONE common list per key (the platform org may hold a key under both renderings: the shared winner rule picks).
  const byKey = new Map<string, CommonRow[]>();
  for (const c of commonRows) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]);
  const commons = new Map<string, CommonRow>();
  for (const [key, rows] of byKey) {
    const ranked = rankRows(rows, platformOrg);
    commons.set(key, ranked[0]);
    if (ranked.length > 1) out.warnings.push(`the platform organization holds common list key "${key}" ${ranked.length} times (renderings of its id); using ${ranked[0].id}`);
  }
  out.commonCount = commons.size;
  if (commons.size === 0) {
    out.warnings.push('no active common (platform) list exists yet: nothing to fork against (publish them first, design record 9.5)');
    return out;
  }

  const commonKeys = [...commons.keys()];
  const commonSeedKeys = [...new Set([...commons.values()].map((c) => c.seed_list_key).filter((k): k is string => !!k))];
  const copies: CopyRow[] = await ex('selection_lists')
    .where({ seed_source: 'platform' })
    .whereNull('forked_from_list_id')
    .andWhereNot('visibility', 'platform')
    .whereNotIn('organization_id', platformForms)
    .andWhere((b) => b.whereIn('key', commonKeys).orWhereIn('seed_list_key', commonSeedKeys))
    .orderBy('id')
    .select(...COPY_COLS);

  const commonIds = [...commons.values()].map((c) => c.id);
  const forkedAlready = new Set<string>();
  const existing: Array<{ organization_id: string; forked_from_list_id: string }> = await ex('selection_lists')
    .whereIn('forked_from_list_id', commonIds)
    .select('organization_id', 'forked_from_list_id');
  for (const f of existing) {
    const org = canonicalOrgId(f.organization_id);
    if (org) forkedAlready.add(`${org}|${f.forked_from_list_id}`);
  }

  const groups = new Map<string, PlannedFork[]>();
  for (const copy of copies) {
    const common = commons.get(copy.key);
    if (!common) {
      out.skipped.push({
        listId: copy.id,
        organizationId: copy.organization_id,
        reason: copy.key.includes(DUP_SEPARATOR)
          ? 'a loser of reconcile-duplicates (renamed + archived): left a plain list'
          : 'renamed copy: its key differs from the common list, and a fork must keep its source key (left a plain list)',
        detail: { key: copy.key, seedListKey: copy.seed_list_key },
      });
      continue;
    }
    if (common.seed_key && (copy.seed_key !== common.seed_key || copy.seed_list_key !== common.seed_list_key)) {
      out.skipped.push({ listId: copy.id, organizationId: copy.organization_id, reason: 'provenance mismatch with the common list (seed pack / list key differ): left alone' });
      continue;
    }
    const org = canonicalOrgId(copy.organization_id);
    if (!org) {
      out.skipped.push({ listId: copy.id, organizationId: copy.organization_id, reason: 'unsupported-org-id (no org_ TypeID form: its event cannot be written): left alone' });
      continue;
    }
    const gk = `${org}|${common.id}`;
    if (forkedAlready.has(gk)) {
      out.skipped.push({ listId: copy.id, organizationId: copy.organization_id, reason: 'the organization already holds a fork of this common list: left alone' });
      continue;
    }
    groups.set(gk, [...(groups.get(gk) ?? []), { copy, common, org }]);
  }
  for (const members of groups.values()) {
    const ranked = rankRows(members.map((m) => ({ ...m.copy, m })), NO_CLAIM);
    out.planned.push(ranked[0].m);
    for (const loser of ranked.slice(1)) {
      out.skipped.push({
        listId: loser.id,
        organizationId: loser.organization_id,
        reason: 'the organization holds this copy under two renderings of its id: only the winner is converted (run reconcile-duplicates)',
        detail: { winner: ranked[0].id },
      });
    }
  }
  out.planned.sort((a, b) => (a.copy.id < b.copy.id ? -1 : 1));
  return out;
}

/** How many items of each planned copy would get an origin (same code in the common list), for the dry run. */
async function countMappable(ex: Knex | Knex.Transaction, planned: PlannedFork[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const byCommon = new Map<string, string[]>();
  for (const p of planned) byCommon.set(p.common.id, [...(byCommon.get(p.common.id) ?? []), p.copy.id]);
  for (const [commonId, copyIds] of byCommon) {
    for (let i = 0; i < copyIds.length; i += IN_CHUNK) {
      const res = await ex.raw(
        `SELECT i.list_id, count(*)::int AS n
           FROM selection_list_items i
           JOIN selection_list_items s ON s.list_id = ? AND s.code = i.code
          WHERE i.list_id = ANY(?) AND i.origin_item_id IS NULL
          GROUP BY i.list_id`,
        [commonId, copyIds.slice(i, i + IN_CHUNK)],
      );
      for (const r of (res as { rows: Array<{ list_id: string; n: number }> }).rows) out.set(r.list_id, r.n);
    }
  }
  return out;
}

type Outcome =
  | { kind: 'forked'; itemsMapped: number }
  | { kind: 'skip'; reason: string };

async function applyOne(db: Knex, p: PlannedFork, correlationId: string): Promise<Outcome> {
  return db.transaction(async (trx): Promise<Outcome> => {
    await lockOrgOutbox(trx, p.copy.organization_id);
    const copy = await trx('selection_lists').where({ id: p.copy.id }).forNoKeyUpdate().first('id', 'organization_id', 'key', 'visibility', 'seed_source', 'forked_from_list_id');
    if (!copy || copy.forked_from_list_id || copy.visibility === 'platform' || copy.seed_source !== 'platform' || copy.key !== p.common.key) {
      return { kind: 'skip', reason: 'the list changed since the plan: left alone' };
    }
    const held = await trx('selection_lists').whereIn('organization_id', orgRenderings(copy.organization_id)).andWhere('forked_from_list_id', p.common.id).first('id');
    if (held) return { kind: 'skip', reason: 'the organization already holds a fork of this common list: left alone' };
    const srcRes = await trx.raw(`SELECT id, organization_id, key, revision, visibility, status FROM selection_lists WHERE id = ? FOR SHARE`, [p.common.id]);
    const src = (srcRes as { rows: Array<{ id: string; organization_id: string; key: string; revision: string | number; visibility: string; status: string }> }).rows[0];
    if (!src || src.visibility !== 'platform' || src.status !== 'active' || src.key !== copy.key) {
      return { kind: 'skip', reason: 'the common list changed since the plan: left alone' };
    }
    const mappable = await trx.raw(
      `SELECT count(*)::int AS n FROM selection_list_items i JOIN selection_list_items s ON s.list_id = ? AND s.code = i.code WHERE i.list_id = ? AND i.origin_item_id IS NULL`,
      [src.id, copy.id],
    );
    if ((mappable as { rows: Array<{ n: number }> }).rows[0].n > SELECTION_LIST_MAX_FORK_ITEMS) {
      return { kind: 'skip', reason: `more than ${SELECTION_LIST_MAX_FORK_ITEMS} items to map (the list.forked bound): left alone` };
    }
    const sourceOrg = wireOrgId(src.organization_id);
    const revision = Number(src.revision);
    await trx('selection_lists')
      .where({ id: copy.id })
      .update({
        forked_from_list_id: src.id,
        forked_from_org_id: sourceOrg,
        forked_from_revision: revision,
        forked_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
    const mapped = await trx.raw(
      `UPDATE selection_list_items i SET origin_item_id = s.id
         FROM selection_list_items s
        WHERE i.list_id = ? AND s.list_id = ? AND s.code = i.code AND i.origin_item_id IS NULL
        RETURNING s.id AS origin_item_id, i.id AS item_id`,
      [copy.id, src.id],
    );
    const itemMap = (mapped as { rows: Array<{ origin_item_id: string; item_id: string }> }).rows
      .map((r) => ({ originItemId: r.origin_item_id, itemId: r.item_id }))
      .sort((a, b) => (a.originItemId < b.originItemId ? -1 : 1));
    await emitListForkedRetroactive(trx, systemEventContext(copy.organization_id, null, correlationId), {
      listId: copy.id,
      source: { listId: src.id, organizationId: sourceOrg, listKey: src.key, listRevision: revision },
      itemMap,
    });
    return { kind: 'forked', itemsMapped: itemMap.length };
  });
}

export async function runRetroForks(db: Knex, mode: RolloutMode = 'dry-run'): Promise<RolloutReport> {
  const runId = newRunId();
  const report = emptyReport('retro-forks', mode, runId);
  const correlationId = correlationFor('retro-forks', runId);

  const snapshot = await withReadOnly(db, async (trx) => {
    const p = await plan(trx);
    const lists = await loadAllLists(trx);
    return { p, duplicates: findKeyGroups(lists).length + findForkGroups(lists).length, mappable: await countMappable(trx, p.planned) };
  });
  report.warnings.push(...snapshot.p.warnings);
  report.skipped.push(...snapshot.p.skipped);

  if (snapshot.duplicates > 0) {
    const msg = `${snapshot.duplicates} duplicate group(s) exist (the audit is not clean): run reconcile-duplicates first`;
    if (mode === 'apply') throw new RolloutPreconditionError(msg);
    report.warnings.push(`${msg}; --apply would refuse`);
  }

  if (mode === 'dry-run') {
    for (const p of snapshot.p.planned) {
      report.changes.push(changeOf(p, snapshot.mappable.get(p.copy.id) ?? 0));
    }
  } else {
    for (const p of snapshot.p.planned) {
      let out: Outcome;
      try {
        out = await applyOne(db, p, correlationId);
      } catch (err) {
        if (!isEventRefusal(err)) throw err;
        // the copy's transaction rolled back whole: nothing of it was written
        report.blocked.push({
          listId: p.copy.id,
          organizationId: p.copy.organization_id,
          reason: 'its event violates the event contract (legacy data, e.g. an invalid key): left a plain list, decide by hand',
          detail: { key: p.copy.key, error: (err as Error).message.slice(0, 300) },
        });
        continue;
      }
      if (out.kind === 'forked') {
        report.changes.push(changeOf(p, out.itemsMapped));
        log.info({ listId: p.copy.id, common: p.common.id, org: p.org, itemsMapped: out.itemsMapped, runId }, 'organization copy made a fork of the common list');
      } else {
        report.skipped.push({ listId: p.copy.id, organizationId: p.copy.organization_id, reason: out.reason });
      }
    }
  }

  report.summary = {
    commonLists: snapshot.p.commonCount,
    candidateCopies: snapshot.p.planned.length,
    [mode === 'dry-run' ? 'wouldFork' : 'forked']: report.changes.length,
    leftAlone: report.skipped.length,
  };
  return finish(report);
}

function changeOf(p: PlannedFork, itemsMapped: number): RolloutChange {
  return {
    listId: p.copy.id,
    organizationId: p.copy.organization_id,
    action: 'make a fork of the common list',
    detail: { key: p.copy.key, common: p.common.id, itemsMapped },
  };
}
