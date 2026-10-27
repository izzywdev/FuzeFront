// shared-lists.renderings-noplatform.db.test.ts - an organization is ONE org whatever rendering of its id the token
// carries, whenever the shared-lists flag is ON - NOT only while the platform organization resolves.
//
// The platform org can legitimately be unavailable (SELECTION_LIST_PLATFORM_ORG_ID unset, or set but not yet
// confirmed by the org projection). Platform features fail closed then, but an ordinary org's own lists (seeding
// stores them under the wire TypeID; tokens may carry the bare UUID) must stay reachable for read, list, write,
// delete, quota, resolve and key uniqueness. Only the foreign `platform` rows, `publish_platform` and the
// platform tenant depend on the platform org. Real app, real handlers, real Postgres.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { createWorld, EDITOR_ACTIONS as EDITOR, P, PLATFORM, Principal, publishPriorityList, World } from './helpers/sharedWorld';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

const TYPE_ID = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d10');
const UUID = toUuid(TYPE_ID as never);
const byType: Principal = { userId: fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7d11'), orgId: TYPE_ID };
const byUuid: Principal = { userId: fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7d12'), orgId: UUID };

dbDescribe('flag ON, platform org unavailable: the own org still matches under every rendering (real Postgres)', () => {
  let w: World;
  let platform: { listId: string; low: string; mid: string; old: string };
  let own: { listId: string; itemId: string };

  beforeAll(async () => {
    w = await createWorld(state);
    for (const p of [byType, byUuid]) w.authz.allowCatalog(p.orgId, p.userId, [...EDITOR, 'read_quota']);
    platform = await publishPriorityList(w); // a foreign common list, published while the platform org resolves
    // The org's list is STORED UNDER THE TYPEID (what seeding does), visibility org.
    const made = await w.api(byType).post('/v1/selection-lists', { key: 'own-org', name: 'Own', visibility: 'org' });
    expect(made.status).toBe(201);
    const item = await w.api(byType).post(`/v1/selection-lists/${made.body.id}/items`, { code: 'ONE', label: 'One' });
    expect(item.status).toBe(201);
    own = { listId: made.body.id, itemId: item.body.id };
    expect((await w.db('selection_lists').where({ id: own.listId }).first()).organization_id).toBe(TYPE_ID);
    // the bare-UUID principal holds the instance role (the Security API holds it in the tenant its token carries)
    w.authz.give(UUID, byUuid.userId, own.listId, 'list-owner');
  });
  afterAll(() => w.teardown());

  const ids = (res: any): string[] => res.body.items.map((i: any) => i.key).sort();

  /** Put the platform org into one of its unavailable states, run `fn`, restore. */
  const degraded = (label: string, enter: () => Promise<void>, leave: () => Promise<void>) =>
    describe(label, () => {
      beforeAll(async () => {
        const { _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
        await enter();
        _resetPlatformOrgCacheForTesting();
      });
      afterAll(async () => {
        const { _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
        await leave();
        _resetPlatformOrgCacheForTesting();
      });

      it('platform features are indeed unavailable (no common list is served, nobody can publish)', async () => {
        expect((await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`)).status).toBe(404);
        expect((await w.api(P.op).post('/v1/selection-lists', { key: `nope-${label.length}`, name: 'N', visibility: 'platform' })).status).toBe(403);
      });

      it('read: the bare-UUID token reads the row stored under the TypeID', async () => {
        const res = await w.api(byUuid).get(`/v1/selection-lists/${own.listId}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: own.listId, key: 'own-org', organization_id: TYPE_ID });
        const items = await w.api(byUuid).get(`/v1/selection-lists/${own.listId}/items`);
        expect(items.status).toBe(200);
        expect(items.body.items.map((i: any) => i.code)).toEqual(['ONE']);
        // translations read path
        expect((await w.api(byUuid).get(`/v1/selection-lists/${own.listId}/translations`)).status).toBe(200);
      });

      it('list: default listing and include_shared both include it; foreign platform rows stay excluded', async () => {
        expect(ids(await w.api(byUuid).get('/v1/selection-lists'))).toEqual(['own-org']);
        const shared = await w.api(byUuid).get('/v1/selection-lists?include_shared=true');
        expect(shared.status).toBe(200);
        expect(ids(shared)).toEqual(['own-org']); // no `priority`: the platform org is unavailable
        expect(ids(await w.api(byUuid).get('/v1/selection-lists?include_shared=true&visibility=platform'))).toEqual([]);
      });

      it('resolve: the org\'s own item resolves for the UUID token; a foreign platform item is missing', async () => {
        const res = await w.api(byUuid).post('/v1/resolve', { ids: [own.itemId, platform.low] });
        expect(res.status).toBe(200);
        expect(Object.keys(res.body.results)).toEqual([own.itemId]);
        expect(res.body.missing).toEqual([platform.low]);
      });

      it('write: patch, item create/patch/archive and translation writes go through the UUID token', async () => {
        const api = w.api(byUuid);
        const url = `/v1/selection-lists/${own.listId}`;
        expect((await api.patch(url, { description: `d-${Math.random()}` })).status).toBe(200);
        const item = await api.post(`${url}/items`, { code: `N${Math.random().toString(36).slice(2, 7)}`, label: 'New' });
        expect(item.status).toBe(201);
        expect((await api.patch(`${url}/items/${item.body.id}`, { label: 'New2' })).status).toBe(200);
        expect((await api.put(`${url}/translations/fr`, { name: 'Propre' })).status).toBe(200);
        expect((await api.put(`${url}/items/${item.body.id}/translations/fr`, { label: 'Nouveau' })).status).toBe(200);
        expect((await api.del(`${url}/items/${item.body.id}?purge=true`)).status).toBe(204);
      });

      it('quota: usage counts the row and an override stored under the TypeID applies (create is refused at the ceiling)', async () => {
        const q = await w.api(byUuid).get('/v1/selection-lists/quota');
        expect(q.status).toBe(200);
        const org = q.body.quotas.find((x: any) => x.scope === 'org_lists');
        expect(org.current).toBeGreaterThanOrEqual(1);
        await w.db('selection_list_org_quota').insert({ organization_id: TYPE_ID, updated_by: 'usr_x', max_lists: org.current });
        try {
          const limited = (await w.api(byUuid).get('/v1/selection-lists/quota')).body.quotas.find((x: any) => x.scope === 'org_lists');
          expect(limited.limit).toBe(org.current);
          const refused = await w.api(byUuid).post('/v1/selection-lists', { key: `over-${label.length}`, name: 'Over' });
          expect(refused.status).toBe(403);
          expect(refused.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'org_lists' });
        } finally {
          await w.db('selection_list_org_quota').where({ organization_id: TYPE_ID }).delete();
        }
      });

      it('key uniqueness: create and rename through the UUID token collide with the TypeID-stored key (409)', async () => {
        const dup = await w.api(byUuid).post('/v1/selection-lists', { key: 'own-org', name: 'Dup' });
        expect(dup.status).toBe(409);
        const mine = await w.api(byUuid).post('/v1/selection-lists', { key: `fresh-${label.length}`, name: 'Fresh' }); // stored under the UUID
        expect(mine.status).toBe(201);
        w.authz.give(UUID, byUuid.userId, mine.body.id, 'list-owner');
        const rename = await w.api(byUuid).patch(`/v1/selection-lists/${mine.body.id}`, { key: 'own-org' });
        expect(rename.status).toBe(409);
        expect((await w.db('selection_lists').where({ id: mine.body.id }).first()).key).toBe(`fresh-${label.length}`);
        expect((await w.api(byUuid).del(`/v1/selection-lists/${mine.body.id}?purge=true`)).status).toBe(204); // leave the world as found
      });

      it('another org never matches either rendering', async () => {
        expect((await w.api(P.bMember).get(`/v1/selection-lists/${own.listId}`)).status).toBe(404);
        expect((await w.api(P.bMember).patch(`/v1/selection-lists/${own.listId}`, { description: 'x' })).status).toBe(404);
      });

      it('delete: archive then purge through the UUID token (last, so the other tests keep their row)', async () => {
        const extra = await w.api(byType).post('/v1/selection-lists', { key: `del-${label.length}`, name: 'Del', visibility: 'org' });
        expect(extra.status).toBe(201);
        w.authz.give(UUID, byUuid.userId, extra.body.id, 'list-owner');
        const url = `/v1/selection-lists/${extra.body.id}`;
        const archived = await w.api(byUuid).del(url);
        expect(archived.status).toBe(200);
        expect(archived.body.status).toBe('archived');
        expect((await w.api(byUuid).patch(url, { status: 'active' })).status).toBe(200);
        expect((await w.api(byUuid).post(`${url}/archive`)).status).toBe(200);
        expect((await w.api(byUuid).del(`${url}?purge=true`)).status).toBe(204);
        expect(await w.db('selection_lists').where({ id: extra.body.id }).first()).toBeUndefined();
      });
    });

  degraded(
    'SELECTION_LIST_PLATFORM_ORG_ID unset',
    async () => {
      delete process.env.SELECTION_LIST_PLATFORM_ORG_ID;
    },
    async () => {
      process.env.SELECTION_LIST_PLATFORM_ORG_ID = PLATFORM;
    },
  );

  let projectionRow: Record<string, unknown> | undefined;
  degraded(
    'SELECTION_LIST_PLATFORM_ORG_ID set but not confirmed by the org projection',
    async () => {
      projectionRow = await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).first();
      await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ org_type: null });
    },
    async () => {
      await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ org_type: projectionRow?.org_type as string });
    },
  );
});
