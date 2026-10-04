// seed.routes.db.test.ts - seeding as seen through the HTTP API, on real Postgres:
//   - every list/item response carries the required, nullable `seed` object and VALIDATES against
//     openapi.yaml (the real spec file, via Ajv), for user-authored rows, seeded rows
//     (created_by = system:selection-list-service) and rows anonymised to the [deleted-user] sentinel;
//   - a human edit of a seeded row (PATCH list/item, translation PUT/DELETE, archive) sets
//     seed.user_modified = true - and ONLY a real edit does (a no-op PATCH, a reorder, an autofill
//     machine translation do not), without bumping revision / emitting anything it should not;
//   - a seeded list can be purged over HTTP (the seed audit rows must not block the delete), and the
//     next pack version neither overwrites an edited list nor recreates a purged one;
//   - the HTTP create path and the seed algorithm share the org lock order (no deadlock under load).

import type { Knex } from 'knex';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { TOPICS } from '@fuzefront/shared/kafka';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';
import { allowSource, appRequest, eventsAfter, maxSeq, projectOrg, spec } from './helpers/seedFixtures';
import { assertConforms, conformanceErrors, specVersion } from './helpers/openapi';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

import { createApp } from '../src/app';
import { setFlagClient } from '../src/flags';
import { _setAuthzClientForTesting, makeNoOpProxy } from '../src/middleware/authz';
import { _setGrantTokenProviderForTesting } from '../src/lib/machineIdentity';
import { applySeedRequest } from '../src/seed';
import { handleUserDeleted } from '../src/events/user-deleted.handler';

const JWT_SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-seed-routes';
const ORG = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7f01');
const USER = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7f01');
const USER_UUID = '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7f01';
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ userId: USER, orgId: ORG }, JWT_SECRET)}` });
const SYSTEM = 'system:selection-list-service';

dbDescribe('seeded rows over HTTP (real Postgres)', () => {
  let t: TestDb;
  let db: Knex;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    state.db = db;
    process.env.JWT_SECRET = JWT_SECRET;
    delete process.env.FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED;
    setFlagClient({ getBooleanValue: async () => true });
    _setAuthzClientForTesting(makeNoOpProxy());
    _setGrantTokenProviderForTesting({ getToken: async () => 'machine-token' });
    app = createApp();
    await allowSource(db, 'fuzecrm');
    await projectOrg(db, ORG);
  });
  afterAll(async () => {
    setFlagClient(null);
    _setGrantTokenProviderForTesting(null);
    delete process.env.JWT_SECRET;
    await t.drop();
  });

  const v1 = [spec('fuzecrm-stages', ['LEAD', 'WON']), spec('fuzecrm-sources', ['WEB', 'REFERRAL']), spec('fuzecrm-regions', ['EMEA'])];
  const base = (version: number, lists: any[]) => appRequest(ORG, { pack: { key: 'crm-defaults', version }, lists });
  const listIdOf = async (key: string) => (await db('selection_lists').where({ organization_id: ORG, seed_list_key: key }).first())!.id as string;
  const itemIdOf = async (listKey: string, code: string) => (await db('selection_list_items').where({ list_id: await listIdOf(listKey), code }).first())!.id as string;
  const getList = async (id: string) => (await request(app).get(`/v1/selection-lists/${id}`).set(auth())).body;
  const getItem = async (listId: string, itemId: string) => {
    for (const status of ['active', 'archived']) {
      const res = await request(app).get(`/v1/selection-lists/${listId}/items`).set(auth()).query({ status });
      const found = res.body.items?.find((i: any) => i.id === itemId);
      if (found) return found;
    }
    return undefined;
  };

  it('pins the contract under test: openapi.yaml is the 4.x line (required nullable seed, AuthorPrincipal)', () => {
    expect(specVersion()).toMatch(/^4\./);
  });

  it('responses carry the required `seed` (null for user rows, the provenance for seeded rows) and validate against openapi.yaml', async () => {
    // user-authored list + item
    let res = await request(app).post('/v1/selection-lists').set(auth()).send({ key: 'my-own', name: 'Mine' });
    expect(res.status).toBe(201);
    expect(res.body.seed).toBeNull();
    expect(res.body.created_by).toBe(USER);
    assertConforms('SelectionList', res.body);
    const mine = res.body.id;
    res = await request(app).post(`/v1/selection-lists/${mine}/items`).set(auth()).send({ code: 'A', label: 'A' });
    expect(res.status).toBe(201);
    expect(res.body.seed).toBeNull();
    assertConforms('SelectionListItem', res.body);

    // seeded rows
    await applySeedRequest(db, base(1, v1));
    const stages = await listIdOf('fuzecrm-stages');
    res = await request(app).get(`/v1/selection-lists/${stages}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.seed).toEqual({ source: 'fuzecrm', pack_key: 'crm-defaults', pack_version: 1, user_modified: false });
    expect(res.body.created_by).toBe(SYSTEM);
    assertConforms('SelectionList', res.body);

    res = await request(app).get('/v1/selection-lists').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(4);
    for (const l of res.body.items) assertConforms('SelectionList', l);
    assertConforms('Page', res.body.page);
    expect(res.body.items.filter((l: any) => l.seed === null)).toHaveLength(1);

    res = await request(app).get(`/v1/selection-lists/${stages}/items`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    for (const i of res.body.items) {
      assertConforms('SelectionListItem', i);
      expect(i.created_by).toBe(SYSTEM);
      expect(i.seed).toEqual({ source: 'fuzecrm', pack_key: 'crm-defaults', pack_version: 1, user_modified: false });
    }

    // the deleted-user sentinel (what user-deleted.handler.ts writes) is a valid created_by too
    await db('selection_lists').where({ id: mine }).update({ created_by: USER_UUID });
    await handleUserDeleted({ correlationId: 'c', payload: { userId: USER_UUID, email: 'x@example.com', cascade: 'soft' } } as any);
    res = await request(app).get(`/v1/selection-lists/${mine}`).set(auth());
    expect(res.body.created_by).toBe('[deleted-user]');
    assertConforms('SelectionList', res.body);

    // and the validator really rejects what the contract forbids (it is not vacuous)
    expect(conformanceErrors('SelectionList', { ...res.body, seed: undefined })).not.toEqual([]); // `seed` is required
    expect(conformanceErrors('SelectionList', { ...res.body, created_by: 'someone' })).not.toEqual([]);
    expect(conformanceErrors('SelectionList', { ...res.body, seed: { source: 'x' } })).not.toEqual([]);
  });

  describe('a human edit sets seed.user_modified (and only a real edit does)', () => {
    it('list: a no-op PATCH does not; a rename, a retitle, a human translation, an archive each do', async () => {
      const pack = 'edits-list';
      const mk = (suffix: string) => spec(`fuzecrm-${suffix}`, ['A']);
      await applySeedRequest(db, appRequest(ORG, { pack: { key: pack, version: 1 }, lists: [mk('e1'), mk('e2'), mk('e3'), mk('e4'), mk('e5')] }));
      const row = async (suffix: string) => (await db('selection_lists').where({ organization_id: ORG, seed_key: pack, seed_list_key: `fuzecrm-${suffix}` }).first())!;

      // no-op PATCH: same name -> not an edit, no revision bump
      const e1 = await row('e1');
      let res = await request(app).patch(`/v1/selection-lists/${e1.id}`).set(auth()).send({ name: 'List fuzecrm-e1' });
      expect(res.status).toBe(200);
      expect(res.body.seed.user_modified).toBe(false);
      expect(Number((await row('e1')).revision)).toBe(Number(e1.revision));

      // rename the name
      const e2 = await row('e2');
      res = await request(app).patch(`/v1/selection-lists/${e2.id}`).set(auth()).send({ name: 'My e2' });
      expect(res.body.seed).toEqual({ source: 'fuzecrm', pack_key: pack, pack_version: 1, user_modified: true });
      assertConforms('SelectionList', res.body);
      // the list.updated event written in the SAME transaction already carries userModified: true
      const lastUpdated = (await db('event_outbox').where({ topic: TOPICS.SELECTION_LISTS_LIST_UPDATED }).orderBy('seq', 'desc').first())!;
      expect(lastUpdated.payload.list.seed.userModified).toBe(true);

      // rename the key
      const e3 = await row('e3');
      res = await request(app).patch(`/v1/selection-lists/${e3.id}`).set(auth()).send({ key: 'renamed-e3' });
      expect(res.body.seed.user_modified).toBe(true);

      // a human translation
      const e4 = await row('e4');
      res = await request(app).put(`/v1/selection-lists/${e4.id}/translations/fr`).set(auth()).send({ name: 'Liste' });
      expect(res.status).toBe(200);
      expect((await getList(e4.id)).seed.user_modified).toBe(true);
      // ... and deleting that translation again restores the seeded content, but the flag is STICKY
      res = await request(app).delete(`/v1/selection-lists/${e4.id}/translations/fr`).set(auth());
      expect(res.status).toBe(204);
      expect((await getList(e4.id)).seed.user_modified).toBe(true);

      // archive
      const e5 = await row('e5');
      res = await request(app).post(`/v1/selection-lists/${e5.id}/archive`).set(auth());
      expect(res.body.seed.user_modified).toBe(true);
      expect(res.body.status).toBe('archived');
    });

    it('item: a label edit and an archive do; a sort_order change, a reorder and an autofill machine translation do not; the LIST stays unmodified', async () => {
      const pack = 'edits-items';
      await applySeedRequest(db, appRequest(ORG, { pack: { key: pack, version: 1 }, lists: [spec('fuzecrm-items', ['I1', 'I2', 'I3', 'I4'])] }));
      const list = (await db('selection_lists').where({ organization_id: ORG, seed_key: pack }).first())!;
      const item = async (code: string) => (await db('selection_list_items').where({ list_id: list.id, code }).first())!;
      const i1 = await item('I1');
      const i2 = await item('I2');
      const i3 = await item('I3');
      const i4 = await item('I4');

      let res = await request(app).patch(`/v1/selection-lists/${list.id}/items/${i1.id}`).set(auth()).send({ label: 'Edited' });
      expect(res.status).toBe(200);
      expect(res.body.seed).toEqual({ source: 'fuzecrm', pack_key: pack, pack_version: 1, user_modified: true });
      assertConforms('SelectionListItem', res.body);

      res = await request(app).patch(`/v1/selection-lists/${list.id}/items/${i2.id}`).set(auth()).send({ sort_order: 999 });
      expect(res.status).toBe(200);
      expect(res.body.seed.user_modified).toBe(false);

      res = await request(app).put(`/v1/selection-lists/${list.id}/items/reorder`).set(auth()).send({ item_ids: [i4.id, i3.id, i2.id, i1.id] });
      expect(res.status).toBe(200);
      for (const i of res.body.items) expect(i.seed.user_modified).toBe(i.id === i1.id);

      res = await request(app).post(`/v1/selection-lists/${list.id}/translations/de/autofill`).set(auth()).send({});
      expect(res.status).toBe(200);
      expect((await getItem(list.id, i3.id)).seed.user_modified).toBe(false);
      expect((await getList(list.id)).seed.user_modified).toBe(false);

      res = await request(app).post(`/v1/selection-lists/${list.id}/items/${i3.id}/archive`).set(auth());
      expect(res.body.seed.user_modified).toBe(true);
      res = await request(app).put(`/v1/selection-lists/${list.id}/items/${i4.id}/translations/fr`).set(auth()).send({ label: 'Quatre' });
      expect(res.status).toBe(200);
      expect((await getItem(list.id, i4.id)).seed.user_modified).toBe(true);
      expect((await getItem(list.id, i2.id)).seed.user_modified).toBe(false);
      expect((await getList(list.id)).seed.user_modified).toBe(false); // item edits never make the LIST user-edited
    });
  });

  it('end to end: after a human edit/purge over HTTP, pack v2 leaves the edited list alone and does not recreate the purged one; purging a seeded list is not blocked by its audit rows', async () => {
    const pack = 'e2e';
    const lists = (extra: any[] = []) => [spec('fuzecrm-e2e-a', ['A1']), spec('fuzecrm-e2e-b', ['B1']), spec('fuzecrm-e2e-c', ['C1']), ...extra];
    await applySeedRequest(db, appRequest(ORG, { pack: { key: pack, version: 1 }, lists: lists() }));
    const id = async (k: string) => (await db('selection_lists').where({ organization_id: ORG, seed_key: pack, seed_list_key: k }).first())!.id as string;
    const a = await id('fuzecrm-e2e-a');
    const b = await id('fuzecrm-e2e-b');

    let res = await request(app).patch(`/v1/selection-lists/${a}`).set(auth()).send({ description: 'my notes' });
    expect(res.body.seed.user_modified).toBe(true);
    res = await request(app).delete(`/v1/selection-lists/${b}?purge=true`).set(auth());
    expect(res.status).toBe(204);
    // the audit trail survives the purge, detached from the (gone) list and still readable
    const detached = await db('selection_list_audit').whereNull('list_id').where({ action: 'seed.applied' }).whereRaw("after->>'listId' = ?", [b]);
    expect(detached).toHaveLength(1);
    expect(detached[0].after.listKey).toBe('fuzecrm-e2e-b');

    const before = await maxSeq(db);
    const r2 = await applySeedRequest(
      db,
      appRequest(ORG, { pack: { key: pack, version: 2 }, lists: [spec('fuzecrm-e2e-a', ['A1', 'A2']), spec('fuzecrm-e2e-b', ['B1', 'B2']), spec('fuzecrm-e2e-c', ['C1', 'C2']), spec('fuzecrm-e2e-d', ['D1'])] }),
    );
    expect(r2.status).toBe('completed');
    const byKey = Object.fromEntries((r2 as any).lists.map((l: any) => [l.key, l.action]));
    expect(byKey).toEqual({ 'fuzecrm-e2e-a': 'skipped-user-edited', 'fuzecrm-e2e-b': 'skipped-user-deleted', 'fuzecrm-e2e-c': 'updated', 'fuzecrm-e2e-d': 'created' });
    expect(await db('selection_lists').where({ organization_id: ORG, seed_list_key: 'fuzecrm-e2e-b' })).toHaveLength(0);
    expect(await db('selection_list_items').where({ list_id: a })).toHaveLength(1); // untouched
    // and the new HTTP view shows the result
    res = await request(app).get(`/v1/selection-lists/${await id('fuzecrm-e2e-c')}/items`).set(auth());
    expect(res.body.items.map((i: any) => i.code)).toEqual(['C1', 'C2']);
    expect((await eventsAfter(db, before)).filter((e) => e.payload.listId === a)).toEqual([]);
  });

  it('HTTP creates and seed requests of one org run concurrently without deadlock (shared lock order)', async () => {
    const seeds = [1, 2, 3].map((i) => applySeedRequest(db, appRequest(ORG, { pack: { key: `conc-${i}`, version: 1 }, lists: [spec(`fuzecrm-conc-${i}`, ['X', 'Y'])] })));
    const creates = [1, 2, 3, 4].map((i) => request(app).post('/v1/selection-lists').set(auth()).send({ key: `conc-http-${i}`, name: `Http ${i}` }));
    const results = await Promise.all([...seeds, ...creates]);
    for (const r of results.slice(0, 3)) expect((r as any).status).toBe('completed');
    for (const r of results.slice(3)) expect((r as request.Response).status).toBe(201);
  });
});
