// shared-lists.renderings-duplicates.db.test.ts - one organization, the SAME key under SEVERAL renderings of its id.
//
// `(organization_id, key)` is unique per stored string, so while shared lists were OFF (or from older data) the same
// org can hold `key` under the bare UUID AND the `org_...` TypeID. With the flag ON the rendering-aware scope merges
// them into one org, so every consumer that answers "the list for this key" must pick ONE row, the SAME one:
//   1. an ACTIVE row over an archived one, 2. the row stored under the caller's claim exactly, 3. the oldest, then id.
// Covered: the listing / effective-key lookup, the resolve fork redirect, the fork idempotency lookup, shadowing.
// Flag OFF creates are untouched (not tested here: they are the 4.0.0 behaviour).

import fs from 'fs';
import path from 'path';
import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { createWorld, EDITOR_ACTIONS as EDITOR, PLATFORM, Principal, publishPriorityList, World } from './helpers/sharedWorld';
import { flagClientWith } from './helpers/flagClient';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('duplicate keys across renderings yield exactly one effective row (real Postgres)', () => {
  let w: World;
  let platform: { listId: string; low: string; mid: string; old: string };
  let seq = 0;

  beforeAll(async () => {
    w = await createWorld(state);
    platform = await publishPriorityList(w);
  });
  afterAll(() => w.teardown());

  /** An org with a caller per rendering (both hold the catalog actions in their own tenant string). */
  const orgWorld = () => {
    const n = String(10 + ++seq).padStart(2, '0');
    const typeId = fromUuid('organization', `0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7b${n}`);
    const uuid = toUuid(typeId as never);
    const byType: Principal = { userId: fromUuid('user', `0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7b${n}`), orgId: typeId };
    const byUuid: Principal = { userId: toUuid(byType.userId as never), orgId: uuid };
    for (const p of [byType, byUuid]) w.authz.allowCatalog(p.orgId, p.userId, EDITOR);
    return { typeId, uuid, byType, byUuid };
  };

  let rowSeq = 0;
  /** Insert a list row directly (the flag-OFF world could create both); `ageMin` = how old it is. */
  const insertList = async (org: string, key: string, over: Record<string, unknown> = {}, ageMin = 0) => {
    const id = `front_sl_dup${String(++rowSeq).padStart(4, '0')}`;
    await w.db('selection_lists').insert({
      id,
      organization_id: org,
      key,
      created_by: 'usr_x',
      visibility: 'org',
      created_at: new Date(Date.now() - ageMin * 60_000),
      ...over,
    });
    await w.db('selection_list_translations').insert({ list_id: id, locale: 'en', name: `${key} (${org.slice(0, 8)})`, source_hash: 'h', is_machine: false });
    return id;
  };

  const keys = (res: any) => res.body.items.map((i: any) => i.key);
  const list = (p: Principal, qs: string) => w.api(p).get(`/v1/selection-lists${qs}`);

  describe('the listing / effective-key lookup', () => {
    it('returns exactly ONE row for the key; the caller\'s exact rendering wins; the answer is stable', async () => {
      const x = orgWorld();
      const typeRow = await insertList(x.typeId, 'dup-pick', {}, 10);
      const uuidRow = await insertList(x.uuid, 'dup-pick', {}, 20); // OLDER, but not the caller's rendering for byType
      for (let i = 0; i < 3; i++) {
        const t = await list(x.byType, '?include_shared=true&key=dup-pick');
        expect(t.status).toBe(200);
        expect(t.body.items.map((r: any) => r.id)).toEqual([typeRow]);
        const u = await list(x.byUuid, '?include_shared=true&key=dup-pick');
        expect(u.body.items.map((r: any) => r.id)).toEqual([uuidRow]);
      }
      // the default listing (instance roles only) is the same effective list, even when the caller holds a role on both
      w.authz.give(x.typeId, x.byType.userId, typeRow, 'list-owner');
      w.authz.give(x.typeId, x.byType.userId, uuidRow, 'list-owner');
      const d = await list(x.byType, '?key=dup-pick');
      expect(d.body.items.map((r: any) => r.id)).toEqual([typeRow]);
    });

    it('an ACTIVE row beats an archived one, whatever the rendering or age', async () => {
      const x = orgWorld();
      await insertList(x.uuid, 'dup-active', { status: 'archived' }, 30); // the caller's exact rendering, oldest, but archived
      const active = await insertList(x.typeId, 'dup-active', {}, 5);
      const res = await list(x.byUuid, '?include_shared=true&key=dup-active&status=all');
      expect(res.body.items.map((r: any) => r.id)).toEqual([active]);
      const only = await list(x.byUuid, '?include_shared=true&key=dup-active');
      expect(only.body.items.map((r: any) => r.id)).toEqual([active]);
    });

    it('equal rank (same age): the smallest id wins, for any caller', async () => {
      const x = orgWorld();
      const when = new Date('2026-01-01T00:00:00.000Z');
      const platformUuid = toUuid(PLATFORM as never);
      const lo = await insertList(PLATFORM, 'dup-tie', { visibility: 'platform', created_at: when });
      const hi = await insertList(platformUuid, 'dup-tie', { visibility: 'platform', created_at: when });
      expect(lo < hi).toBe(true);
      for (const p of [x.byType, x.byUuid]) expect((await list(p, '?include_shared=true&key=dup-tie')).body.items.map((r: any) => r.id)).toEqual([lo]);
    });

    it('the whole listing shows each key once and pages through every effective list exactly once', async () => {
      const x = orgWorld();
      const a = await insertList(x.typeId, 'dup-a', {}, 10);
      await insertList(x.uuid, 'dup-a', {}, 11);
      const b = await insertList(x.uuid, 'dup-b', {}, 12);
      await insertList(x.typeId, 'dup-b', {}, 13);
      const only = await insertList(x.typeId, 'solo', {}, 14);
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: any = await list(x.byType, `?include_shared=true&visibility=org&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
        expect(res.status).toBe(200);
        seen.push(...res.body.items.map((r: any) => r.id));
        cursor = res.body.page.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);
      // byType: dup-a -> its TypeID row; dup-b -> the TypeID row too (exact claim); solo
      const winners = new Set(seen);
      expect(winners.size).toBe(seen.length); // no row twice
      const ids = await w.db('selection_lists').whereIn('id', seen).select('id', 'key', 'organization_id');
      expect(ids.map((r: any) => r.key).sort()).toEqual(['dup-a', 'dup-b', 'solo']);
      expect(seen).toContain(a);
      expect(seen).toContain(only);
      expect(seen).not.toContain(b); // byType's exact rendering wins dup-b as well
    });

    it('common lists: duplicates of a platform key across the platform org\'s renderings collapse to one (oldest) for any other tenant', async () => {
      const x = orgWorld();
      const platformUuid = toUuid(PLATFORM as never);
      const first = await insertList(PLATFORM, 'dup-common', { visibility: 'platform' }, 40);
      await insertList(platformUuid, 'dup-common', { visibility: 'platform' }, 10);
      for (const p of [x.byType, x.byUuid]) {
        const res = await list(p, '?include_shared=true&key=dup-common');
        expect(res.status).toBe(200);
        expect(res.body.items.map((r: any) => r.id)).toEqual([first]);
      }
    });

    it('shadowing: the org\'s own (duplicated) list hides the common list of the same key, and appears once', async () => {
      const x = orgWorld();
      const t = await insertList(x.typeId, 'priority', {}, 10); // shadows the platform's `priority`
      await insertList(x.uuid, 'priority', {}, 11);
      const res = await list(x.byType, '?include_shared=true&key=priority');
      expect(res.body.items.map((r: any) => r.id)).toEqual([t]);
      expect(res.body.items.map((r: any) => r.organization_id)).toEqual([x.typeId]);
    });

    it('flag OFF: the 4.0.0 exact scope (a caller sees only its own stored rendering)', async () => {
      const x = orgWorld();
      const t = await insertList(x.typeId, 'dup-off', { visibility: 'private' }, 10);
      const u = await insertList(x.uuid, 'dup-off', { visibility: 'private' }, 11);
      w.authz.give(x.typeId, x.byType.userId, t, 'list-owner');
      w.authz.give(x.uuid, x.byUuid.userId, u, 'list-owner');
      const { setFlagClient } = await import('../src/flags');
      setFlagClient(flagClientWith(false));
      try {
        expect((await list(x.byType, '?key=dup-off')).body.items.map((r: any) => r.id)).toEqual([t]);
        expect((await list(x.byUuid, '?key=dup-off')).body.items.map((r: any) => r.id)).toEqual([u]);
      } finally {
        setFlagClient(flagClientWith(true));
      }
    });
  });

  describe('resolve and fork', () => {
    /** Forks of the common list under BOTH renderings of the org, each with an item that redirects from `platform.low`. */
    const forksUnderBoth = async (x: ReturnType<typeof orgWorld>) => {
      const mk = async (org: string, ageMin: number) => {
        const id = await insertList(x.typeId === org ? org : org, 'priority', { forked_from_list_id: platform.listId, forked_from_org_id: PLATFORM, forked_from_revision: 1, forked_at: new Date() }, ageMin);
        const itemId = `front_sli_dup${String(++rowSeq).padStart(4, '0')}`;
        await w.db('selection_list_items').insert({ id: itemId, list_id: id, code: 'LOW', sort_order: 100, status: 'active', created_by: 'usr_x', origin_item_id: platform.low });
        await w.db('selection_list_item_translations').insert({ item_id: itemId, locale: 'en', label: `Low (${org.slice(0, 8)})`, source_hash: 'h', is_machine: false });
        return { id, itemId };
      };
      return { typeFork: await mk(x.typeId, 10), uuidFork: await mk(x.uuid, 20) };
    };

    it('resolve: a stored common id redirects to exactly ONE fork item, the caller\'s exact rendering first; stable', async () => {
      const x = orgWorld();
      const { typeFork, uuidFork } = await forksUnderBoth(x);
      for (let i = 0; i < 3; i++) {
        const t = await w.api(x.byType).post('/v1/resolve', { ids: [platform.low] });
        expect(t.status).toBe(200);
        expect(Object.keys(t.body.results)).toEqual([platform.low]);
        expect(t.body.results[platform.low].effective_item_id).toBe(typeFork.itemId);
        const u = await w.api(x.byUuid).post('/v1/resolve', { ids: [platform.low] });
        expect(u.body.results[platform.low].effective_item_id).toBe(uuidFork.itemId);
      }
    });

    it('fork: the idempotent repeat answers the SAME fork (caller\'s exact rendering) however many exist', async () => {
      const x = orgWorld();
      const { typeFork, uuidFork } = await forksUnderBoth(x);
      for (let i = 0; i < 2; i++) {
        const t = await w.api(x.byType).post(`/v1/selection-lists/${platform.listId}/fork`, {});
        expect(t.status).toBe(200);
        expect(t.body.id).toBe(typeFork.id);
        const u = await w.api(x.byUuid).post(`/v1/selection-lists/${platform.listId}/fork`, {});
        expect(u.body.id).toBe(uuidFork.id);
      }
    });
  });

  describe('the rollout runbook SQL (docs/runbooks/selection-lists-rollout.md section 10) is real and correct', () => {
    const runbook = fs.readFileSync(path.join(__dirname, '../../../docs/runbooks/selection-lists-rollout.md'), 'utf8');
    const section = runbook.slice(runbook.indexOf('### 10.1'));
    const sqlBlocks = [...section.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
    const queryA = sqlBlocks[0].slice(sqlBlocks[0].indexOf('WITH rows AS'), sqlBlocks[0].indexOf('-- B.'));
    const queryB = sqlBlocks[0].slice(sqlBlocks[0].indexOf('-- B.'), sqlBlocks[0].indexOf('-- C.'));
    const queryC = sqlBlocks[0].slice(sqlBlocks[0].indexOf('-- C.'));
    const fallback = sqlBlocks[1];

    it('A finds the duplicate, the fallback UPDATE reconciles it (winner kept, loser renamed + archived, ids kept), A is then empty', async () => {
      const x = orgWorld();
      await w.db('selection_list_ref_index').insert({ entity_type: 'organization', entity_id: x.uuid, status: 'active', wire_id: x.typeId, org_type: 'organization', is_active: true });
      const loser = await insertList(x.uuid, 'rb-dup', {}, 5);
      const winner = await insertList(x.typeId, 'rb-dup', {}, 50); // older, both active: wins
      const found = (await w.db.raw(queryA)).rows.filter((r: any) => r.org_uuid === x.uuid);
      expect(found).toHaveLength(1);
      expect(found[0].ids_winner_first).toEqual([winner, loser]);
      expect(Number(found[0].rows)).toBe(2);
      // B and C run (no forks here; C lists orgs the projection does not know: only OTHER tests' orgs, never this one)
      await w.db.raw(queryB);
      expect((await w.db.raw(queryC)).rows.map((r: any) => r.organization_id)).not.toContain(x.typeId);
      // the fallback reconciliation, with this loser's id filled in
      const stmt = fallback.replace("IN ('<loser id>', '<loser id>')", `IN ('${loser}')`);
      await w.db.raw(stmt);
      expect((await w.db.raw(queryA)).rows.filter((r: any) => r.org_uuid === x.uuid)).toHaveLength(0);
      expect(await w.db('selection_lists').where({ id: winner }).first()).toMatchObject({ key: 'rb-dup', status: 'active' });
      const l = await w.db('selection_lists').where({ id: loser }).first();
      expect(l.status).toBe('archived');
      expect(l.key).toMatch(/^rb-dup--dup-/);
    });
  });
});
