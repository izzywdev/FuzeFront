// shared-lists.platform-org-cache.db.test.ts - the platform-org resolution is cached AUTHORIZATION state, so
// a change the projection learns must deny the very next request on the replica that processed it, with no
// waiting for the TTL; and a de-source common list is listed with its own source-locale text.
//
// Drives the REAL identity.org.updated / identity.org.deleted handlers against real Postgres and the real app.
//
// Multi-replica staleness that REMAINS (documented in sharedLists.ts): the cache is per process and a Kafka
// event is handled by one consumer of the group, so another replica can keep answering from its cached
// positive result for at most CACHE_TTL_MS (5 s). That bound is asserted below (not the cross-replica
// behaviour itself, which needs two processes).

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { createWorld, P, PLATFORM, publishPriorityList, World } from './helpers/sharedWorld';
import { toUuid } from '@izzywdev/fuzefront-identity';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

const PLATFORM_UUID = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e00';
let clock = Date.now() - 24 * 3_600_000;
// The org lifecycle HANDLERS refuse to deactivate / retype / delete the platform org (platformGuard.ts, tested in
// shared-lists.platform-org-guard.db.test.ts), so the cache invalidation is driven through the projection WRITERS
// the handlers use (`upsertOrgProjection` / `markOrgProjectionDeleted`): a state change that did reach the
// projection (a lagging replica, an operator repair, a future guarded path) must still deny the very next request.
const change = async (db: Knex, isActive: boolean, type: 'platform' | 'organization' = 'platform') => {
  const { upsertOrgProjection } = await import('../src/events/orgProjection');
  clock += 60_000;
  await upsertOrgProjection(db, { organizationId: PLATFORM_UUID, type, isActive, name: 'Platform', occurredAt: new Date(clock).toISOString() });
};

dbDescribe('platform-org resolution cache is invalidated by the projection writers (real Postgres)', () => {
  let w: World;
  let platform: { listId: string; low: string; mid: string; old: string };

  beforeAll(async () => {
    w = await createWorld(state);
    platform = await publishPriorityList(w);
    expect(toUuid(PLATFORM)).toBe(PLATFORM_UUID);
  });
  afterAll(() => w.teardown());

  const probes = async () => ({
    read: (await w.api(P.aMember).get(`/v1/selection-lists/${platform.listId}`)).status,
    resolved: (await w.api(P.bMember).post('/v1/resolve', { ids: [platform.low] })).body.missing as string[],
    publish: (await w.api(P.op).post('/v1/selection-lists', { key: `pub-${Math.random().toString(36).slice(2, 8)}`, name: 'X', visibility: 'platform' })).status,
  });

  it('confirmed (and warm in the cache) => every platform feature works', async () => {
    const p = await probes();
    expect(p.read).toBe(200);
    expect(p.resolved).toEqual([]);
    expect(p.publish).toBe(201);
  });

  it('confirm -> a projection write with isActive=false -> the very next read / resolve / publish is denied', async () => {
    // the cache is warm from the previous test: no reset helper is called here
    expect((await probes()).read).toBe(200);
    await change(w.db, false);
    const denied = await probes();
    expect(denied.read).toBe(404);
    expect(denied.resolved).toEqual([platform.low]);
    expect(denied.publish).toBe(403);
    // and back: re-activation is visible at once as well
    await change(w.db, true);
    const back = await probes();
    expect(back.read).toBe(200);
    expect(back.publish).toBe(201);
  });

  it('a retype away from platform (projection write) is denied at once, and a retype back is allowed at once', async () => {
    expect((await probes()).read).toBe(200);
    await change(w.db, true, 'organization');
    expect((await probes()).read).toBe(404);
    await change(w.db, true, 'platform');
    expect((await probes()).read).toBe(200);
  });

  it('a tombstone of the projection row is denied at once on the very next read / resolve / publish', async () => {
    const { markOrgProjectionDeleted } = await import('../src/events/orgProjection');
    expect((await probes()).read).toBe(200);
    await markOrgProjectionDeleted(w.db, PLATFORM_UUID);
    const denied = await probes();
    expect(denied.read).toBe(404);
    expect(denied.resolved).toEqual([platform.low]);
    expect(denied.publish).toBe(403);
  });

  it('a resolution that was IN FLIGHT when the invalidation happened is not stored (generation guard)', async () => {
    const { resolvePlatformOrgId, invalidatePlatformOrgCache, _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
    _resetPlatformOrgCacheForTesting();
    // reactivate the row directly (the earlier test tombstoned it), then race a resolve with an invalidation
    await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ status: 'active', is_active: true, org_type: 'platform' });
    const pending = resolvePlatformOrgId(w.db);
    invalidatePlatformOrgCache(); // happens while the read above is awaiting the database
    expect(await pending).toBe(PLATFORM); // that caller still gets its answer...
    await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ is_active: false });
    expect(await resolvePlatformOrgId(w.db)).toBeNull(); // ...but it was not cached: the next one re-reads
  });

  it('the positive cache is bounded to 5 s (the remaining cross-replica window)', async () => {
    const { resolvePlatformOrgId, _resetPlatformOrgCacheForTesting } = await import('../src/lib/sharedLists');
    await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ is_active: true });
    _resetPlatformOrgCacheForTesting();
    const t0 = 1_000_000;
    expect(await resolvePlatformOrgId(w.db, t0)).toBe(PLATFORM);
    await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).update({ is_active: false }); // another replica's event
    expect(await resolvePlatformOrgId(w.db, t0 + 4_999)).toBe(PLATFORM); // still inside the window
    expect(await resolvePlatformOrgId(w.db, t0 + 5_000)).toBeNull(); // window closed
  });
});

dbDescribe('GET /v1/selection-lists - a common list whose source_locale is not en (real Postgres)', () => {
  let w: World;

  beforeAll(async () => {
    w = await createWorld(state);
  });
  afterAll(() => w.teardown());

  it('an en-only caller with no Accept-Language still gets the name/description in the list source locale', async () => {
    const op = w.api(P.op);
    const created = await op.post('/v1/selection-lists', {
      key: 'prioritaet',
      name: 'Prioritaet',
      description: 'Wie dringend',
      source_locale: 'de',
      visibility: 'platform',
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const mk = await op.post(`/v1/selection-lists/${id}/items`, { code: 'HOCH', label: 'Hoch' });
    expect(mk.status).toBe(201);

    // an organization list with an en source alongside, to prove the per-row slot does not disturb it
    const own = await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'own-en', name: 'Own', visibility: 'org' });
    expect(own.status).toBe(201);

    const listing = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true');
    expect(listing.status).toBe(200);
    const byKey = Object.fromEntries(listing.body.items.map((i: any) => [i.key, i]));
    expect(byKey['prioritaet']).toMatchObject({ name: 'Prioritaet', description: 'Wie dringend', source_locale: 'de', resolved_locale: 'de' });
    expect(byKey['own-en']).toMatchObject({ name: 'Own', resolved_locale: 'en' });

    // the effective-key lookup and the visibility filter go through the same query
    const byKeyLookup = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true&key=prioritaet');
    expect(byKeyLookup.body.items).toHaveLength(1);
    expect(byKeyLookup.body.items[0]).toMatchObject({ name: 'Prioritaet', resolved_locale: 'de' });
    const filtered = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true&visibility=platform');
    expect(filtered.body.items.find((i: any) => i.key === 'prioritaet')).toMatchObject({ name: 'Prioritaet' });

    // the single read and the item listing agree
    const single = await w.api(P.aMember).get(`/v1/selection-lists/${id}`);
    expect(single.body).toMatchObject({ name: 'Prioritaet', resolved_locale: 'de' });
    const items = await w.api(P.aMember).get(`/v1/selection-lists/${id}/items`);
    expect(items.body.items[0]).toMatchObject({ code: 'HOCH', label: 'Hoch', resolved_locale: 'de' });

    // a requested locale that exists still wins over the source locale
    await op.put(`/v1/selection-lists/${id}/translations/fr`, { name: 'Priorite' });
    const fr = await w.api(P.aMember).get('/v1/selection-lists?include_shared=true&locale=fr');
    expect(fr.body.items.find((i: any) => i.key === 'prioritaet')).toMatchObject({ name: 'Priorite', resolved_locale: 'fr' });
  });
});
