// Fixtures for the SL9 rollout job suites (src/rollout/*): real Postgres with the real migrations, and a tiny
// vocabulary to seed organizations that hold their lists under one or both renderings of their id.
//
//   const state: { db: Knex | undefined } = { db: undefined };
//   jest.mock('../src/db', () => ({ get db() { return state.db; } }));   // must be in the test file (hoisting)
//   const w = await createRolloutWorld(state);
//
// `orgPair(n)` is one organization under BOTH renderings (`uuid` = bare UUID, `wire` = `org_...` TypeID).

import fs from 'fs';
import path from 'path';
import type { Knex } from 'knex';
import { fromUuid, mintId, toUuid } from '@izzywdev/fuzefront-identity';
import { createTestDb, TestDb } from './testDb';

export interface OrgPair {
  uuid: string;
  wire: string;
}

export const orgPair = (n: number): OrgPair => {
  const uuid = `0195a8f2-7c3e-7a11-8b2d-3f4e5a6b${(0x7000 + n).toString(16)}`;
  return { uuid, wire: fromUuid('organization', uuid) };
};

/** The platform organization used by the retro-fork suite (its projection row confirms it). */
export const PLATFORM = orgPair(0x0f00);

export interface ListOpts {
  key: string;
  org: string;
  status?: 'active' | 'archived';
  visibility?: 'private' | 'org' | 'platform';
  /** minutes ago; the winner rule is oldest first */
  ageMin?: number;
  seed?: { source: string; key: string; listKey: string } | null;
  forkedFrom?: { listId: string; orgId: string; revision?: number } | null;
  name?: string;
  id?: string;
}

export interface RolloutWorld {
  t: TestDb;
  db: Knex;
  insertList: (o: ListOpts) => Promise<string>;
  insertItem: (listId: string, code: string, o?: { status?: string; sort?: number; originItemId?: string | null }) => Promise<string>;
  projectOrg: (p: OrgPair, type?: 'organization' | 'platform') => Promise<void>;
  teardown: () => Promise<void>;
}

export async function createRolloutWorld(state: { db: Knex | undefined }): Promise<RolloutWorld> {
  const t = await createTestDb();
  state.db = t.db;
  let sort = 0;
  const insertList = async (o: ListOpts): Promise<string> => {
    const id = o.id ?? mintId('selectionList');
    const seed = o.seed ?? null;
    await t.db('selection_lists').insert({
      id,
      organization_id: o.org,
      key: o.key,
      status: o.status ?? 'active',
      visibility: o.visibility ?? 'private',
      created_by: 'system:selection-list-service',
      created_at: new Date(Date.now() - (o.ageMin ?? 0) * 60_000),
      seed_source: seed?.source ?? null,
      seed_key: seed?.key ?? null,
      seed_list_key: seed?.listKey ?? null,
      seed_version: seed ? 1 : null,
      seed_hash: seed ? 'h' : null,
      forked_from_list_id: o.forkedFrom?.listId ?? null,
      forked_from_org_id: o.forkedFrom?.orgId ?? null,
      forked_from_revision: o.forkedFrom ? o.forkedFrom.revision ?? 1 : null,
      forked_at: o.forkedFrom ? new Date() : null,
    });
    await t.db('selection_list_translations').insert({ list_id: id, locale: 'en', name: o.name ?? o.key, source_hash: 'h', is_machine: false });
    return id;
  };
  const insertItem: RolloutWorld['insertItem'] = async (listId, code, o = {}) => {
    const id = mintId('selectionListItem');
    await t.db('selection_list_items').insert({
      id,
      list_id: listId,
      code,
      sort_order: o.sort ?? ++sort,
      status: o.status ?? 'active',
      created_by: 'system:selection-list-service',
      origin_item_id: o.originItemId ?? null,
    });
    await t.db('selection_list_item_translations').insert({ item_id: id, locale: 'en', label: code, source_hash: 'h', is_machine: false });
    return id;
  };
  const projectOrg: RolloutWorld['projectOrg'] = async (p, type = 'organization') => {
    await t.db('selection_list_ref_index').insert({
      entity_type: 'organization',
      entity_id: p.uuid,
      wire_id: p.wire,
      org_type: type,
      is_active: true,
      status: 'active',
    });
  };
  return { t, db: t.db, insertList, insertItem, projectOrg, teardown: () => t.drop() };
}

/** A deterministic dump of everything the jobs could touch, to prove a dry run wrote nothing. */
export async function dump(db: Knex): Promise<string> {
  const rows = async (table: string, order: string) => (await db(table).orderBy(order)).map((r) => JSON.stringify(r));
  // the identity sequence behind event_outbox.seq: even a ROLLED-BACK insert would advance it
  const seqName: string = (await db.raw(`SELECT pg_get_serial_sequence('event_outbox', 'seq') AS s`)).rows[0].s;
  if (!seqName) throw new Error('dump: cannot find the event_outbox.seq sequence');
  const seq = (await db.raw(`SELECT last_value::text AS v, is_called AS c FROM ${seqName}`)).rows[0];
  return JSON.stringify({
    lists: await rows('selection_lists', 'id'),
    items: await rows('selection_list_items', 'id'),
    translations: await rows('selection_list_translations', 'list_id'),
    outbox: (await db('event_outbox').count<{ n: string }>('* as n').first())?.n,
    seq,
  });
}

export const uuidOf = (wire: string): string => toUuid(wire as never);

/** The ```sql block of the rollout runbook that contains `marker` (so the docs' own statements are the ones under test). */
export function runbookSql(marker: string): string {
  const text = fs.readFileSync(path.join(__dirname, '../../../../docs/runbooks/selection-lists-rollout.md'), 'utf8');
  const block = [...text.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.includes(marker));
  if (!block) throw new Error(`no sql block with "${marker}" in the rollout runbook`);
  return block;
}
