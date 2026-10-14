// shared-lists.write.db.test.ts — the WRITE path of shared / common lists (design record D5, D7, D10;
// openapi `x-permit-additional-actions`) through the real app, routes and REAL Postgres.
//
// Pins: every per-list mutation of a common list is `409 fork_required` (+ fork_url / source_list_id) for a
// caller holding SelectionListCatalog:create, `403` without it, `404` when it cannot read it, access
// management is always `403`; create/PATCH `visibility` with `manage_access`, `publish_platform` evaluated in
// the PLATFORM tenant, platform-org ownership and the one-way `platform` lock (`409 visibility_locked`);
// purge of a platform list (or one of its items) needs `publish_platform`; every extra check is asked of the
// Security API; visibility.changed events; fail-closed behaviour.

import type { Knex } from 'knex';
import { TOPICS } from '@fuzefront/shared/kafka';
import { dbDescribe } from './helpers/testDb';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { ADMIN_ACTIONS, createWorld, EDITOR_ACTIONS as EDITOR, ORG_A, P, PLATFORM, Principal, publishPriorityList, World } from './helpers/sharedWorld';
import { assertConforms } from './helpers/openapi';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('shared lists — write path (real Postgres)', () => {
  let w: World;
  let platform: { listId: string; low: string; mid: string; old: string };

  beforeAll(async () => {
    w = await createWorld(state);
    platform = await publishPriorityList(w);
  });
  afterAll(() => w.teardown());

  const base = () => `/v1/selection-lists/${platform.listId}`;

  describe('create with a visibility', () => {
    it('org / private need nothing extra; the default is private', async () => {
      const a = await w.api(P.aMember).post('/v1/selection-lists', { key: 'wp-org', name: 'Org', visibility: 'org' });
      expect(a.status).toBe(201);
      expect(a.body).toMatchObject({ visibility: 'org', editable: true, forked_from: null });
      const b = await w.api(P.aMember).post('/v1/selection-lists', { key: 'wp-default', name: 'D' });
      expect(b.body.visibility).toBe('private');
      expect((await w.api(P.aMember).post('/v1/selection-lists', { key: 'wp-bad', name: 'B', visibility: 'public' })).status).toBe(400);
    });

    it('platform: the platform operator publishes (201, owned by the platform org, owner grant in the platform tenant)', async () => {
      const mark = w.authz.asked.length;
      const res = await w.api(P.op).post('/v1/selection-lists', { key: 'wp-common', name: 'Common', visibility: 'platform' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ visibility: 'platform', organization_id: PLATFORM });
      expect(w.authz.since(mark)).toEqual(['catalog:create', 'catalog:publish_platform']);
      const asked = w.authz.asked.slice(mark).find((q) => q.action === 'publish_platform')!;
      expect(asked.tenant).toBe(PLATFORM); // evaluated in the PLATFORM tenant
      const events = await w.newEvents();
      expect(events.some((e) => e.topic === TOPICS.SELECTION_LISTS_LIST_CREATED && e.p.list.visibility === 'platform')).toBe(true);
    });

    it('platform: a customer-org admin HOLDS publish_platform in its own tenant and still gets 403', async () => {
      expect(w.authz.catalog.get(`${ORG_A}|${P.aAdmin.userId}`)?.has('publish_platform')).toBe(true);
      const res = await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'wp-nope', name: 'Nope', visibility: 'platform' });
      expect(res.status).toBe(403);
      expect(await w.db('selection_lists').where({ key: 'wp-nope' }).first()).toBeUndefined();
    });

    it('platform: a platform-org member WITHOUT publish_platform gets 403', async () => {
      const res = await w.api(P.opEditor).post('/v1/selection-lists', { key: 'wp-nope2', name: 'Nope', visibility: 'platform' });
      expect(res.status).toBe(403);
    });

    it('platform: fails closed when the Security API is down', async () => {
      w.authz.down = new Error('DECISION_UNAVAILABLE');
      try {
        expect((await w.api(P.op).post('/v1/selection-lists', { key: 'wp-down', name: 'Down', visibility: 'platform' })).status).toBe(403);
      } finally {
        w.authz.down = null;
      }
    });

    it('rejects a client-supplied id and unknown properties (identifier standard)', async () => {
      const res = await w.api(P.aMember).post('/v1/selection-lists', { key: 'wp-id', name: 'Id', id: 'front_sl_zzzz', visibility: 'org' });
      expect(res.status).toBe(400);
    });
  });

  describe('a mutation of a common list owned by ANOTHER org', () => {
    const mutations: Array<{ name: string; call: (p: Principal) => Promise<any>; access?: boolean }> = [
      { name: 'PATCH list', call: (p) => w.api(p).patch(base(), { name: 'Hijacked' }) },
      { name: 'DELETE list (archive)', call: (p) => w.api(p).del(base()) },
      { name: 'DELETE list (purge)', call: (p) => w.api(p).del(`${base()}?purge=true`) },
      { name: 'POST archive', call: (p) => w.api(p).post(`${base()}/archive`) },
      { name: 'POST item', call: (p) => w.api(p).post(`${base()}/items`, { code: 'NEW', label: 'New' }) },
      { name: 'PUT reorder', call: (p) => w.api(p).put(`${base()}/items/reorder`, { item_ids: [platform.mid, platform.low] }) },
      { name: 'PATCH item', call: (p) => w.api(p).patch(`${base()}/items/${platform.low}`, { label: 'X' }) },
      { name: 'DELETE item (archive)', call: (p) => w.api(p).del(`${base()}/items/${platform.low}`) },
      { name: 'DELETE item (purge)', call: (p) => w.api(p).del(`${base()}/items/${platform.low}?purge=true`) },
      { name: 'POST item archive', call: (p) => w.api(p).post(`${base()}/items/${platform.low}/archive`) },
      { name: 'PUT list translation', call: (p) => w.api(p).put(`${base()}/translations/de`, { name: 'Prio' }) },
      { name: 'DELETE list translation', call: (p) => w.api(p).del(`${base()}/translations/fr`) },
      { name: 'PUT item translation', call: (p) => w.api(p).put(`${base()}/items/${platform.low}/translations/de`, { label: 'Niedrig' }) },
      { name: 'DELETE item translation', call: (p) => w.api(p).del(`${base()}/items/${platform.low}/translations/fr`) },
      { name: 'POST autofill', call: (p) => w.api(p).post(`${base()}/translations/de/autofill`, {}) },
    ];

    it.each(mutations.map((m) => [m.name, m] as const))('%s -> 409 fork_required for a caller with `create`', async (_n, m) => {
      const res = await m.call(P.aMember);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        code: 'CONFLICT',
        message: expect.any(String),
        reason: 'fork_required',
        source_list_id: platform.listId,
        fork_url: `/v1/selection-lists/${platform.listId}/fork`,
      });
      expect(res.body.fork_url).toMatch(/^\/v1\/selection-lists\/front_sl_[0-9a-z]+\/fork$/); // same-origin relative
    });

    it.each(mutations.map((m) => [m.name, m] as const))('%s -> 403 for a reader WITHOUT `create` (viewer)', async (_n, m) => {
      const res = await m.call(P.aViewer);
      expect(res.status).toBe(403);
      expect(res.body.reason).toBeUndefined();
    });

    it.each(mutations.map((m) => [m.name, m] as const))('%s -> 404 when the caller cannot even read it (developer)', async (_n, m) => {
      expect((await m.call(P.aDeveloper)).status).toBe(404);
    });

    it('the fork_required / visibility_locked / created bodies conform to the contract (Error, SelectionList)', async () => {
      assertConforms('Error', (await w.api(P.aMember).patch(base(), { name: 'x' })).body);
      assertConforms('Error', (await w.api(P.op).patch(base(), { visibility: 'org' })).body);
      assertConforms('Error', (await w.api(P.aViewer).patch(base(), { name: 'x' })).body);
      const created = await w.api(P.op).post('/v1/selection-lists', { key: 'conform-common', name: 'C', visibility: 'platform' });
      assertConforms('SelectionList', created.body);
    });

    it('nothing was written by any of them', async () => {
      const row = await w.db('selection_lists').where({ id: platform.listId }).first();
      expect(row.status).toBe('active');
      const items = await w.db('selection_list_items').where({ list_id: platform.listId }).orderBy('code');
      expect(items.map((i: any) => [i.code, i.status])).toEqual([['LOW', 'active'], ['MID', 'active'], ['OLD', 'archived']]);
      const t = await w.db('selection_list_translations').where({ list_id: platform.listId });
      expect(t.map((x: any) => x.locale).sort()).toEqual(['en', 'fr']);
    });

    it('access management of a common list is ALWAYS 403 for a customer (never fork_required), 404 if unreadable', async () => {
      for (const p of [P.aMember, P.aViewer, P.aAdmin]) {
        expect((await w.api(p).get(`${base()}/access`)).status).toBe(403);
        expect((await w.api(p).put(`${base()}/access/${P.aViewer.userId}`, { role: 'list-viewer' })).status).toBe(403);
        expect((await w.api(p).del(`${base()}/access/${P.aViewer.userId}`)).status).toBe(403);
      }
      expect((await w.api(P.aDeveloper).get(`${base()}/access`)).status).toBe(404);
    });

    it('fails closed (403) when the Security API cannot answer', async () => {
      w.authz.down = new Error('DECISION_UNAVAILABLE');
      try {
        expect((await w.api(P.aMember).patch(base(), { name: 'x' })).status).toBe(403);
      } finally {
        w.authz.down = null;
      }
    });

    it('the platform org owner still mutates it normally (instance role), no fork involved', async () => {
      const res = await w.api(P.op).patch(base(), { description: 'How urgent, really' });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('How urgent, really');
      // a platform-org member who is NOT an owner is a plain 403 (it is their own org's list)
      const denied = await w.api(P.opEditor).patch(base(), { description: 'nope' });
      expect(denied.status).toBe(403);
      expect(denied.body.reason).toBeUndefined();
    });
  });

  describe('the platform org under another rendering of its id', () => {
    const uuid = toUuid(PLATFORM as never);
    const opUuid = { userId: P.op.userId, orgId: uuid };
    beforeAll(() => w.authz.allowCatalog(uuid, P.op.userId, ADMIN_ACTIONS));

    it('a common list published through the UUID rendering is stored under the configured TypeID and collides with the TypeID rendering (409)', async () => {
      const a = await w.api(opUuid).post('/v1/selection-lists', { key: 'ren-common', name: 'R', visibility: 'platform' });
      expect(a.status).toBe(201);
      expect(a.body.organization_id).toBe(PLATFORM);
      expect((await w.db('selection_lists').where({ id: a.body.id }).first()).organization_id).toBe(PLATFORM);
      const b = await w.api(P.op).post('/v1/selection-lists', { key: 'ren-common', name: 'R2', visibility: 'platform' });
      expect(b.status).toBe(409);
      const c = await w.api(opUuid).post('/v1/selection-lists', { key: 'ren-common', name: 'R3', visibility: 'platform' });
      expect(c.status).toBe(409);
      expect((await w.db('selection_lists').where({ key: 'ren-common', visibility: 'platform' })).length).toBe(1);
    });

    it('a common list already stored under the OTHER rendering (legacy row) still blocks the key', async () => {
      await w.db('selection_lists').insert({ id: 'front_sl_legacyuuid0001', organization_id: uuid, key: 'legacy-uuid-common', created_by: 'usr_x', visibility: 'platform' });
      const res = await w.api(P.op).post('/v1/selection-lists', { key: 'legacy-uuid-common', name: 'L', visibility: 'platform' });
      expect(res.status).toBe(409);
      await w.db('selection_lists').where({ id: 'front_sl_legacyuuid0001' }).delete();
    });

    it('promotion to platform checks the key across renderings (409), and renaming a common list onto a taken key too', async () => {
      const taken = await w.api(P.op).post('/v1/selection-lists', { key: 'promo-k', name: 'T', visibility: 'platform' });
      expect(taken.status).toBe(201);
      // a private list stored under the UUID rendering (a legacy row: a create through either rendering of the
      // platform org would now collide with the common list's key)
      const mine = { body: { id: 'front_sl_promok00000001' }, status: 201 };
      await w.db('selection_lists').insert({ id: mine.body.id, organization_id: uuid, key: 'promo-k', created_by: 'usr_x' });
      w.authz.give(uuid, opUuid.userId, mine.body.id, 'list-owner');
      const promote = await w.api(opUuid).patch(`/v1/selection-lists/${mine.body.id}`, { visibility: 'platform' });
      expect(promote.status).toBe(409);
      expect((await w.db('selection_lists').where({ id: mine.body.id }).first()).visibility).toBe('private');
      // an unrelated key promotes fine
      const other = await w.api(opUuid).post('/v1/selection-lists', { key: 'promo-ok', name: 'Ok' });
      expect((await w.api(opUuid).patch(`/v1/selection-lists/${other.body.id}`, { visibility: 'platform' })).status).toBe(200);
      // rename of a common list onto a taken key
      const rename = await w.api(P.op).patch(`/v1/selection-lists/${taken.body.id}`, { key: 'ren-common' });
      expect(rename.status).toBe(409);
    });
  });

  describe('writes by an operator whose token carries the OTHER rendering of the platform org id', () => {
    const uuid = toUuid(PLATFORM as never);
    const opUuid = { userId: P.op.userId, orgId: uuid };

    const operate = async (creator: Principal, operator: Principal, key: string) => {
      const created = await w.api(creator).post('/v1/selection-lists', { key, name: key, visibility: 'platform' });
      expect(created.status).toBe(201);
      const id: string = created.body.id;
      expect(created.body.organization_id).toBe(PLATFORM); // always stored under the configured id
      // the Security API holds the operator's instance role in the tenant its token carries
      w.authz.give(operator.orgId, operator.userId, id, 'list-owner');
      const api = w.api(operator);
      const url = `/v1/selection-lists/${id}`;
      expect((await api.patch(url, { description: 'edited by the other rendering' })).status).toBe(200);
      const item = await api.post(`${url}/items`, { code: 'X', label: 'X' });
      expect(item.status).toBe(201);
      expect((await api.patch(`${url}/items/${item.body.id}`, { label: 'X2' })).status).toBe(200);
      expect((await api.put(`${url}/translations/fr`, { name: 'Clé' })).status).toBe(200);
      expect((await api.get(`${url}/access`)).status).toBe(200); // manage_access
      expect((await api.post(`${url}/archive`)).status).toBe(200);
      expect((await api.patch(url, { status: 'active' })).status).toBe(200);
      expect((await api.del(`${url}/items/${item.body.id}`)).status).toBe(200);
      expect((await api.del(`${url}?purge=true`)).status).toBe(204);
    };

    it('UUID-token operator operates a platform list created through the TypeID rendering (and the reverse)', async () => {
      w.authz.allowCatalog(uuid, P.op.userId, ADMIN_ACTIONS);
      await operate(P.op, opUuid, 'wr-typeid-made');
      await operate(opUuid, P.op, 'wr-uuid-made');
    });

    it('a DIFFERENT org\'s rendering still gets 404 for a platform org\'s private list (and fork_required for a common one)', async () => {
      const priv = await w.api(P.op).post('/v1/selection-lists', { key: 'wr-private', name: 'P' });
      expect(priv.status).toBe(201);
      for (const p of [P.aAdmin, { userId: P.aAdmin.userId, orgId: toUuid(ORG_A as never) }, P.bMember]) {
        w.authz.allowCatalog(p.orgId, p.userId, ADMIN_ACTIONS);
        expect((await w.api(p).patch(`/v1/selection-lists/${priv.body.id}`, { name: 'hijack' })).status).toBe(404);
        expect((await w.api(p).del(`/v1/selection-lists/${priv.body.id}`)).status).toBe(404);
      }
      expect((await w.db('selection_lists').where({ id: priv.body.id }).first()).status).toBe('active');
    });
  });

  describe('quotas of the platform org / one org under two renderings', () => {
    it('org_lists override stored under the TypeID applies to a create through the UUID rendering (flag ON)', async () => {
      const typeId = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e91');
      const uuid = toUuid(typeId as never);
      const byType = { userId: 'usr_01quotaren0000000000000000a', orgId: typeId };
      const byUuid = { userId: 'usr_01quotaren0000000000000000b', orgId: uuid };
      for (const p of [byType, byUuid]) w.authz.allowCatalog(p.orgId, p.userId, EDITOR);
      await w.db('selection_list_org_quota').insert({ organization_id: typeId, updated_by: 'usr_x', max_lists: 1 });
      expect((await w.api(byType).post('/v1/selection-lists', { key: 'q-one', name: 'One' })).status).toBe(201);
      const res = await w.api(byUuid).post('/v1/selection-lists', { key: 'q-two', name: 'Two' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'org_lists', limit: 1 });
    });

    it('creating a platform list counts the platform org\'s lists under every rendering', async () => {
      const uuid = toUuid(PLATFORM as never);
      const opUuid = { userId: P.op.userId, orgId: uuid };
      w.authz.allowCatalog(uuid, P.op.userId, ADMIN_ACTIONS);
      await w.db('selection_list_org_quota').insert({ organization_id: PLATFORM, updated_by: 'usr_x', max_lists: 1 });
      try {
        const res = await w.api(opUuid).post('/v1/selection-lists', { key: 'q-common', name: 'Q', visibility: 'platform' });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'org_lists', limit: 1 });
      } finally {
        await w.db('selection_list_org_quota').where({ organization_id: PLATFORM }).delete();
      }
    });

    it('un-archiving counts across renderings too', async () => {
      const typeId = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e92');
      const uuid = toUuid(typeId as never);
      const byType = { userId: 'usr_01quotaren0000000000000000c', orgId: typeId };
      const byUuid = { userId: 'usr_01quotaren0000000000000000d', orgId: uuid };
      for (const p of [byType, byUuid]) w.authz.allowCatalog(p.orgId, p.userId, EDITOR);
      await w.db('selection_list_org_quota').insert({ organization_id: typeId, updated_by: 'usr_x', max_lists: 1 });
      const first = await w.api(byType).post('/v1/selection-lists', { key: 'u-one', name: 'One' });
      expect((await w.api(byType).post(`/v1/selection-lists/${first.body.id}/archive`)).status).toBe(200);
      expect((await w.api(byType).post('/v1/selection-lists', { key: 'u-two', name: 'Two' })).status).toBe(201);
      w.authz.give(uuid, byUuid.userId, first.body.id, 'list-owner');
      const res = await w.api(byUuid).patch(`/v1/selection-lists/${first.body.id}`, { status: 'active' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'org_lists' });
    });
  });

  describe('item and locale quotas follow the org across renderings of its id', () => {
    // Each case: the list is created through one rendering, the override row is stored under `overrideRendering`
    // and the write comes through the OTHER one. n picks fresh orgs.
    const world = (n: number) => {
      const typeId = fromUuid('organization', `0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7f${n}0`);
      const uuid = toUuid(typeId as never);
      const byType = { userId: `usr_01iquota${n}00000000000000000a`, orgId: typeId };
      const byUuid = { userId: `usr_01iquota${n}00000000000000000b`, orgId: uuid };
      for (const p of [byType, byUuid]) w.authz.allowCatalog(p.orgId, p.userId, EDITOR);
      return { typeId, uuid, byType, byUuid };
    };
    const mkList = async (creator: Principal, other: Principal, key: string) => {
      const r = await w.api(creator).post('/v1/selection-lists', { key, name: key });
      expect(r.status).toBe(201);
      w.authz.give(other.orgId, other.userId, r.body.id, 'list-owner'); // the Security API holds the role in either tenant
      return r.body.id as string;
    };

    it.each([
      ['override under the TypeID, write through the UUID', 1, true],
      ['override under the UUID, write through the TypeID', 2, false],
    ] as const)('list_items: %s', async (_n, n, overrideOnType) => {
      const x = world(n);
      const [creator, writer] = overrideOnType ? [x.byType, x.byUuid] : [x.byUuid, x.byType];
      await w.db('selection_list_org_quota').insert({ organization_id: overrideOnType ? x.typeId : x.uuid, updated_by: 'usr_x', max_items_per_list: 1 });
      const listId = await mkList(creator, writer, `iq-items-${n}`);
      const first = await w.api(creator).post(`/v1/selection-lists/${listId}/items`, { code: 'A', label: 'A' });
      expect(first.status).toBe(201);
      const second = await w.api(writer).post(`/v1/selection-lists/${listId}/items`, { code: 'B', label: 'B' });
      expect(second.status).toBe(403);
      expect(second.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_items', limit: 1 });
    });

    it('list_items: re-activating an archived item counts across renderings', async () => {
      const x = world(3);
      await w.db('selection_list_org_quota').insert({ organization_id: x.typeId, updated_by: 'usr_x', max_items_per_list: 1 });
      const listId = await mkList(x.byType, x.byUuid, 'iq-react');
      const a = await w.api(x.byType).post(`/v1/selection-lists/${listId}/items`, { code: 'A', label: 'A' });
      await w.api(x.byType).post(`/v1/selection-lists/${listId}/items/${a.body.id}/archive`);
      expect((await w.api(x.byType).post(`/v1/selection-lists/${listId}/items`, { code: 'B', label: 'B' })).status).toBe(201);
      const res = await w.api(x.byUuid).patch(`/v1/selection-lists/${listId}/items/${a.body.id}`, { status: 'active' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_items' });
    });

    it.each([
      ['override under the TypeID, write through the UUID', 4, true],
      ['override under the UUID, write through the TypeID', 5, false],
    ] as const)('list_locales: %s', async (_n, n, overrideOnType) => {
      const x = world(n);
      const [creator, writer] = overrideOnType ? [x.byType, x.byUuid] : [x.byUuid, x.byType];
      await w.db('selection_list_org_quota').insert({ organization_id: overrideOnType ? x.typeId : x.uuid, updated_by: 'usr_x', max_locales: 1 });
      const listId = await mkList(creator, writer, `iq-loc-${n}`);
      const put = await w.api(writer).put(`/v1/selection-lists/${listId}/translations/fr`, { name: 'Clé' });
      expect(put.status).toBe(403);
      expect(put.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_locales', limit: 1 });
      // the PATCH path that writes a new source-locale row is held to the same ceiling
      const patch = await w.api(writer).patch(`/v1/selection-lists/${listId}`, { source_locale: 'de', name: 'Name' });
      expect(patch.status).toBe(403);
      expect(patch.body.scope).toBe('list_locales');
    });

    it('without any override the defaults apply and nothing is blocked (no false positives)', async () => {
      const x = world(6);
      const listId = await mkList(x.byType, x.byUuid, 'iq-free');
      expect((await w.api(x.byUuid).post(`/v1/selection-lists/${listId}/items`, { code: 'A', label: 'A' })).status).toBe(201);
      expect((await w.api(x.byUuid).put(`/v1/selection-lists/${listId}/translations/fr`, { name: 'Clé' })).status).toBe(200);
    });
  });

  describe('PATCH visibility', () => {
    let listId: string;
    beforeAll(async () => {
      const r = await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'vis-test', name: 'Vis' });
      listId = r.body.id;
      await w.newEvents();
    });
    const url = () => `/v1/selection-lists/${listId}`;

    it('the owner changes private -> org -> private; each change emits visibility.changed with its own revision', async () => {
      const mark = w.authz.asked.length;
      const a = await w.api(P.aAdmin).patch(url(), { visibility: 'org' });
      expect(a.status).toBe(200);
      expect(a.body).toMatchObject({ visibility: 'org', editable: true });
      // update (base) + manage_access (the access decision) — nothing else for a non-platform visibility
      expect(w.authz.since(mark).slice(0, 2)).toEqual(['list:update', 'list:manage_access']);
      let ev = await w.newEvents();
      expect(ev.map((e) => e.topic)).toEqual([TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED]);
      expect(ev[0].p).toMatchObject({ previousVisibility: 'private', visibility: 'org', list: { visibility: 'org', listId } });
      const rev1 = ev[0].p.listRevision;

      const b = await w.api(P.aAdmin).patch(url(), { visibility: 'private' });
      expect(b.body.visibility).toBe('private');
      ev = await w.newEvents();
      expect(ev[0].p).toMatchObject({ previousVisibility: 'org', visibility: 'private' });
      expect(ev[0].p.listRevision).toBeGreaterThan(rev1);
    });

    it('a combined PATCH emits list.updated (other fields) then visibility.changed, both in one transaction', async () => {
      const res = await w.api(P.aAdmin).patch(url(), { name: 'Vis 2', visibility: 'org' });
      expect(res.status).toBe(200);
      const ev = await w.newEvents();
      expect(ev.map((e) => e.topic)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED, TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED]);
      expect(ev[1].p.listRevision).toBeGreaterThan(ev[0].p.listRevision);
      await w.api(P.aAdmin).patch(url(), { visibility: 'private' });
      await w.newEvents();
    });

    it('sending the CURRENT visibility is a no-op (no event) that still requires manage_access', async () => {
      const ok = await w.api(P.aAdmin).patch(url(), { visibility: 'private' });
      expect(ok.status).toBe(200);
      expect(await w.newEvents()).toEqual([]);
      // a list-editor (update, no manage_access) is refused even for the no-op
      w.authz.give(ORG_A, P.aMember.userId, listId, 'list-editor');
      const denied = await w.api(P.aMember).patch(url(), { visibility: 'private' });
      expect(denied.status).toBe(403);
    });

    it('an editor can still edit every OTHER field; only the visibility needs manage_access', async () => {
      w.authz.give(ORG_A, P.aMember.userId, listId, 'list-editor');
      const res = await w.api(P.aMember).patch(url(), { description: 'editor was here' });
      expect(res.status).toBe(200);
      const denied = await w.api(P.aMember).patch(url(), { visibility: 'org' });
      expect(denied.status).toBe(403);
      expect((await w.db('selection_lists').where({ id: listId }).first()).visibility).toBe('private');
    });

    it('promoting to platform: a customer org owner gets 403 (not the platform org) and nothing changes', async () => {
      const res = await w.api(P.aAdmin).patch(url(), { visibility: 'platform' });
      expect(res.status).toBe(403);
      expect((await w.db('selection_lists').where({ id: listId }).first()).visibility).toBe('private');
    });

    it('promoting to platform: the platform operator promotes a platform-org list (publish_platform in the platform tenant)', async () => {
      const mk = await w.api(P.op).post('/v1/selection-lists', { key: 'to-common', name: 'To common' });
      const id = mk.body.id;
      const mark = w.authz.asked.length;
      const res = await w.api(P.op).patch(`/v1/selection-lists/${id}`, { visibility: 'platform' });
      expect(res.status).toBe(200);
      expect(res.body.visibility).toBe('platform');
      expect(w.authz.since(mark)).toEqual(['list:update', 'list:manage_access', 'catalog:publish_platform']);
      expect(w.authz.asked.slice(mark).pop()!.tenant).toBe(PLATFORM);
      // ...and a platform-org owner WITHOUT publish_platform may not
      const mk2 = await w.api(P.opEditor).post('/v1/selection-lists', { key: 'to-common-2', name: 'To common 2' });
      const denied = await w.api(P.opEditor).patch(`/v1/selection-lists/${mk2.body.id}`, { visibility: 'platform' });
      expect(denied.status).toBe(403);
    });

    it('a platform list can NEVER be demoted: 409 visibility_locked (archive it instead), for the operator too', async () => {
      for (const target of ['private', 'org']) {
        const res = await w.api(P.op).patch(base(), { visibility: target });
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'CONFLICT', reason: 'visibility_locked' });
      }
      expect((await w.db('selection_lists').where({ id: platform.listId }).first()).visibility).toBe('platform');
      // sending platform again is a no-op
      expect((await w.api(P.op).patch(base(), { visibility: 'platform' })).status).toBe(200);
      // archive is allowed and archived items keep resolving
      expect((await w.api(P.op).post(`${base()}/archive`)).status).toBe(200);
      expect((await w.api(P.op).patch(base(), { status: 'active' })).status).toBe(200);
    });

    it('a customer cannot reach the visibility of a common list at all (fork_required, not visibility_locked)', async () => {
      const res = await w.api(P.aMember).patch(base(), { visibility: 'private' });
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('fork_required');
    });
  });

  describe('purge of a platform list or one of its items needs publish_platform', () => {
    let common: { listId: string; low: string };
    const mkCommon = async (key: string) => {
      const l = await w.api(P.op).post('/v1/selection-lists', { key, name: key, visibility: 'platform' });
      const i = await w.api(P.op).post(`/v1/selection-lists/${l.body.id}/items`, { code: 'A', label: 'A' });
      return { listId: l.body.id as string, low: i.body.id as string };
    };
    beforeAll(async () => {
      common = await mkCommon('purge-me');
    });

    it('an OWNER of the common list in the platform org without publish_platform is refused (403); nothing is deleted', async () => {
      w.authz.give(PLATFORM, P.opEditor.userId, common.listId, 'list-owner');
      const item = await w.api(P.opEditor).del(`/v1/selection-lists/${common.listId}/items/${common.low}?purge=true`);
      expect(item.status).toBe(403);
      const list = await w.api(P.opEditor).del(`/v1/selection-lists/${common.listId}?purge=true`);
      expect(list.status).toBe(403);
      expect(await w.db('selection_list_items').where({ id: common.low }).first()).toBeDefined();
      expect(await w.db('selection_lists').where({ id: common.listId }).first()).toBeDefined();
      // archive is reversible and stays with the instance owner
      expect((await w.api(P.opEditor).del(`/v1/selection-lists/${common.listId}/items/${common.low}`)).status).toBe(200);
    });

    it('with publish_platform (the operator) the item purge and the list purge succeed; asked in order', async () => {
      const mark = w.authz.asked.length;
      const item = await w.api(P.op).del(`/v1/selection-lists/${common.listId}/items/${common.low}?purge=true`);
      expect(item.status).toBe(204);
      expect(w.authz.since(mark)).toEqual(['list:remove_value', 'list:delete', 'catalog:publish_platform']);
      const mark2 = w.authz.asked.length;
      const list = await w.api(P.op).del(`/v1/selection-lists/${common.listId}?purge=true`);
      expect(list.status).toBe(204);
      expect(w.authz.since(mark2)).toEqual(['list:delete', 'catalog:publish_platform']);
      expect(await w.db('selection_lists').where({ id: common.listId }).first()).toBeUndefined();
    });

    it('the guard does not depend on the flag: with shared-lists OFF a platform row still needs publish_platform to be purged', async () => {
      const c = await mkCommon('purge-flag-off');
      w.authz.give(PLATFORM, P.opEditor.userId, c.listId, 'list-owner');
      const { setFlagClient } = await import('../src/flags');
      const { flagClientWith } = await import('./helpers/flagClient');
      setFlagClient(flagClientWith(false));
      try {
        // owner without publish_platform: refused for the item and the list, nothing deleted
        expect((await w.api(P.opEditor).del(`/v1/selection-lists/${c.listId}/items/${c.low}?purge=true`)).status).toBe(403);
        expect((await w.api(P.opEditor).del(`/v1/selection-lists/${c.listId}?purge=true`)).status).toBe(403);
        expect(await w.db('selection_list_items').where({ id: c.low }).first()).toBeDefined();
        expect(await w.db('selection_lists').where({ id: c.listId }).first()).toBeDefined();
        // archive stays with the owner
        expect((await w.api(P.opEditor).del(`/v1/selection-lists/${c.listId}/items/${c.low}`)).status).toBe(200);
        // with publish_platform it goes through
        const mark = w.authz.asked.length;
        expect((await w.api(P.op).del(`/v1/selection-lists/${c.listId}/items/${c.low}?purge=true`)).status).toBe(204);
        expect(w.authz.since(mark)).toEqual(['list:remove_value', 'list:delete', 'catalog:publish_platform']);
        expect((await w.api(P.op).del(`/v1/selection-lists/${c.listId}?purge=true`)).status).toBe(204);
      } finally {
        setFlagClient(flagClientWith(true));
      }
    });

    it('a private/org list purge does NOT ask publish_platform', async () => {
      const r = await w.api(P.aAdmin).post('/v1/selection-lists', { key: 'purge-private', name: 'P' });
      const mark = w.authz.asked.length;
      expect((await w.api(P.aAdmin).del(`/v1/selection-lists/${r.body.id}?purge=true`)).status).toBe(204);
      expect(w.authz.since(mark)).toEqual(['list:delete']);
    });
  });
});
