// routes.request-validation.db.test.ts - the request-validation half of the contract (openapi 4.0.0),
// against the REAL app on real Postgres (authz is the NODE_ENV=test no-op; flags pinned ON):
//
//   - every request-body schema is `additionalProperties: false` -> an undeclared property (incl. a
//     client-supplied `id` / `uuid` / `organization_id`) is 400 VALIDATION_ERROR on EVERY mutating route;
//   - POST /v1/resolve enforces its `ids` schema (pattern, minItems 1, maxItems 500, uniqueItems) and the
//     locale enum - a cross-type id is a 400, never "missing";
//   - `limit` is an integer >= 1 on every paginated GET (0 / negative / non-integer = 400), over-max is
//     CLAMPED, and the envelope + cursor still walk the whole set.
//
// Complements the independent acceptance suite (tests/selection-list-service/contract/request-validation.test.ts).

import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

import { createApp } from '../src/app';
import { setFlagClient } from '../src/flags';

const SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-request-validation';
const ORG = 'org_01h455vb4pex5vsknk084sn02q';
const USER = 'usr_01h455vb4pex5vsknk084sn02q';
const FOREIGN_ID = '01h455vb4pex5vsknk084sn02q';

dbDescribe('request validation (real app, real Postgres)', () => {
  let t: TestDb;
  let app: ReturnType<typeof createApp>;
  let listId: string;
  let itemIds: string[] = [];
  const auth = () => `Bearer ${jwt.sign({ userId: USER, orgId: ORG }, SECRET)}`;
  const call = (method: 'get' | 'post' | 'put' | 'patch', path: string, body?: unknown) => {
    const r = request(app)[method](path).set('Authorization', auth());
    return body === undefined ? r : r.send(body as object);
  };
  const L = () => `/v1/selection-lists/${listId}`;
  const expect400 = (res: { status: number; body: { code?: string } }) => {
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;
    t = await createTestDb();
    state.db = t.db;
    setFlagClient({ getBooleanValue: async () => true });
    app = createApp();
    const l = await call('post', '/v1/selection-lists', { key: 'rv-list', name: 'Validation' });
    expect(l.status).toBe(201);
    listId = l.body.id;
    for (const code of ['A', 'B', 'C']) {
      const i = await call('post', `${L()}/items`, { code, label: `Item ${code}` });
      expect(i.status).toBe(201);
      itemIds.push(i.body.id);
    }
  });
  afterAll(async () => {
    setFlagClient(null);
    await t.drop();
  });

  describe('additionalProperties: false on every mutating body (id / uuid / organization_id are never accepted)', () => {
    const extras: Array<[string, Record<string, unknown>]> = [
      ['id', { id: `front_sl_${FOREIGN_ID}` }],
      ['uuid', { uuid: '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d00' }],
      ['organization_id', { organization_id: `org_${FOREIGN_ID}` }],
      ['an arbitrary property', { bogus: 1 }],
    ];

    it.each(extras)('PUT list translation rejects %s', async (_n, extra) => {
      expect400(await call('put', `${L()}/translations/fr`, { name: 'x', ...extra }));
    });
    it.each(extras)('PUT item translation rejects %s', async (_n, extra) => {
      expect400(await call('put', `${L()}/items/${itemIds[0]}/translations/fr`, { label: 'x', ...extra }));
    });
    it.each(extras)('PUT reorder rejects %s', async (_n, extra) => {
      expect400(await call('put', `${L()}/items/reorder`, { item_ids: itemIds, ...extra }));
    });
    it.each(extras)('POST autofill rejects %s', async (_n, extra) => {
      expect400(await call('post', `${L()}/translations/es/autofill`, { ...extra }));
    });
    it.each(extras)('POST resolve rejects %s', async (_n, extra) => {
      expect400(await call('post', '/v1/resolve', { ids: [itemIds[0]], ...extra }));
    });
    it.each(extras)('POST create list rejects %s', async (_n, extra) => {
      expect400(await call('post', '/v1/selection-lists', { key: 'rv-extra', name: 'x', ...extra }));
    });
    it.each(extras)('PATCH list rejects %s', async (_n, extra) => {
      expect400(await call('patch', L(), { name: 'x', ...extra }));
    });
    it.each(extras)('POST create item rejects %s', async (_n, extra) => {
      expect400(await call('post', `${L()}/items`, { code: 'Z', label: 'z', ...extra }));
    });
    it.each(extras)('PATCH item rejects %s', async (_n, extra) => {
      expect400(await call('patch', `${L()}/items/${itemIds[0]}`, { label: 'x', ...extra }));
    });
    it.each(extras)('PUT access rejects %s', async (_n, extra) => {
      expect400(await call('put', `${L()}/access/${USER}`, { role: 'list-viewer', ...extra }));
    });

    it('a body that is not a JSON object (an array) is a 400, not a crash', async () => {
      expect400(await call('put', `${L()}/translations/fr`, [{ name: 'x' }]));
      expect400(await call('post', '/v1/resolve', [itemIds[0]]));
    });

    it('nothing was written by any rejected request', async () => {
      expect(await t.db('selection_list_translations').where({ list_id: listId, locale: 'fr' }).first()).toBeUndefined();
      expect(await t.db('selection_lists').where({ organization_id: ORG, key: 'rv-extra' }).first()).toBeUndefined();
    });

    it('the same bodies WITHOUT the extra property are accepted (the check is not over-broad)', async () => {
      expect((await call('put', `${L()}/translations/fr`, { name: 'Validation fr' })).status).toBe(200);
      expect((await call('put', `${L()}/items/${itemIds[0]}/translations/fr`, { label: 'Un' })).status).toBe(200);
      expect((await call('post', `${L()}/translations/es/autofill`, {})).status).toBe(200);
      expect((await call('post', `${L()}/translations/de/autofill`, { overwrite_machine: true, item_ids: [itemIds[0]] })).status).toBe(200);
    });
  });

  describe('reorder / autofill id arrays follow their schemas', () => {
    it('reorder: non-string / foreign-type / duplicate ids are a 400 (not a 500, not a silent pass)', async () => {
      expect400(await call('put', `${L()}/items/reorder`, { item_ids: [itemIds[0], 123, itemIds[2]] }));
      expect400(await call('put', `${L()}/items/reorder`, { item_ids: [itemIds[0], `front_sl_${FOREIGN_ID}`, itemIds[2]] }));
      expect400(await call('put', `${L()}/items/reorder`, { item_ids: [itemIds[0], itemIds[0], itemIds[1]] }));
      expect400(await call('put', `${L()}/items/reorder`, { item_ids: [] }));
      expect400(await call('put', `${L()}/items/reorder`, { item_ids: Array.from({ length: 5001 }, (_v, i) => `front_sli_${i}`) }));
      expect((await call('put', `${L()}/items/reorder`, { item_ids: [...itemIds].reverse() })).status).toBe(200);
    });
    it('autofill: overwrite_machine must be boolean; item_ids must be unique front_sli_ ids', async () => {
      expect400(await call('post', `${L()}/translations/es/autofill`, { overwrite_machine: 'yes' }));
      expect400(await call('post', `${L()}/translations/es/autofill`, { item_ids: 'front_sli_a' }));
      expect400(await call('post', `${L()}/translations/es/autofill`, { item_ids: [`usr_${FOREIGN_ID}`] }));
      expect400(await call('post', `${L()}/translations/es/autofill`, { item_ids: [itemIds[0], itemIds[0]] }));
    });
    it('item sort_order must be an integer number (a numeric string / fraction is a 400)', async () => {
      expect400(await call('post', `${L()}/items`, { code: 'S1', label: 's', sort_order: '5' }));
      expect400(await call('post', `${L()}/items`, { code: 'S2', label: 's', sort_order: 1.5 }));
      expect400(await call('patch', `${L()}/items/${itemIds[0]}`, { sort_order: '5' }));
      expect400(await call('patch', `${L()}/items/${itemIds[0]}`, { sort_order: -1 }));
      expect((await call('patch', `${L()}/items/${itemIds[0]}`, { sort_order: 700 })).status).toBe(200);
    });
  });

  describe('POST /v1/resolve enforces its ids schema', () => {
    const good = () => itemIds[0];
    it.each([
      ['a list id', `front_sl_${FOREIGN_ID}`],
      ['a user id', `usr_${FOREIGN_ID}`],
      ['an org id', `org_${FOREIGN_ID}`],
      ['an upper-case suffix', 'front_sli_ABC'],
      ['a bare UUID', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d00'],
      ['a JSON number', 123],
      ['null', null],
    ])('rejects %s in ids with 400 (cross-type / malformed is not "missing")', async (_n, bad) => {
      expect400(await call('post', '/v1/resolve', { ids: [good(), bad] }));
    });
    it('rejects duplicates, an empty array, > 500 ids, a non-array and an unsupported locale', async () => {
      expect400(await call('post', '/v1/resolve', { ids: [good(), good()] }));
      expect400(await call('post', '/v1/resolve', { ids: [] }));
      expect400(await call('post', '/v1/resolve', { ids: Array.from({ length: 501 }, (_v, i) => `front_sli_${i}`) }));
      expect400(await call('post', '/v1/resolve', { ids: good() }));
      expect400(await call('post', '/v1/resolve', {}));
      expect400(await call('post', '/v1/resolve', { ids: [good()], locale: 'xx' }));
      expect400(await call('post', '/v1/resolve', { ids: [good()], locale: 5 }));
    });
    it('accepts exactly 500 distinct ids, and a valid request resolves (never-created ids are "missing", not an error)', async () => {
      const many = Array.from({ length: 500 }, (_v, i) => `front_sli_${String(i).padStart(26, '0')}`);
      const big = await call('post', '/v1/resolve', { ids: many });
      expect(big.status).toBe(200);
      expect(big.body.missing).toHaveLength(500);
      const ok = await call('post', '/v1/resolve', { ids: [good()], locale: 'en' });
      expect(ok.status).toBe(200);
      expect(ok.body.results[good()]).toMatchObject({ label: 'Item A', status: 'active' });
      expect(ok.body.missing).toEqual([]);
    });
  });

  describe('limit on every paginated GET: integer >= 1, over-max clamped, cursor walks the set', () => {
    const endpoints = (): Array<[string, string]> => [
      ['lists', '/v1/selection-lists'],
      ['items', `${L()}/items`],
      ['access', `${L()}/access`],
    ];
    it.each([['0'], ['-1'], ['abc'], ['1.5'], [''], ['10x']])('limit=%p is a 400 on lists, items and access', async (bad) => {
      for (const [name, path] of endpoints()) {
        const res = await call('get', `${path}?limit=${encodeURIComponent(bad)}`);
        expect({ name, status: res.status }).toEqual({ name, status: 400 });
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
    });
    it('an over-max limit is clamped (200), the envelope is { items, page }, and an omitted limit uses the default', async () => {
      for (const [name, path] of endpoints()) {
        const res = await call('get', `${path}?limit=100000`);
        expect({ name, status: res.status }).toEqual({ name, status: 200 });
        expect(Array.isArray(res.body.items)).toBe(true);
        expect(res.body.page).toHaveProperty('nextCursor');
        expect(typeof res.body.page.hasMore).toBe('boolean');
        expect((await call('get', path)).status).toBe(200);
      }
    });
    it('the clamp really is the max: 205 items, limit=100000 -> exactly 200 returned and hasMore', async () => {
      const big = await call('post', '/v1/selection-lists', { key: 'rv-big', name: 'Big' });
      expect(big.status).toBe(201);
      const rows = Array.from({ length: 205 }, (_v, i) => ({
        id: `front_sli_big${String(i).padStart(6, '0')}`,
        list_id: big.body.id,
        code: `C${i}`,
        sort_order: (i + 1) * 100,
        created_by: USER,
      }));
      await t.db('selection_list_items').insert(rows);
      await t.db('selection_list_item_translations').insert(rows.map((r) => ({ item_id: r.id, locale: 'en', label: r.code, is_machine: false })));
      const res = await call('get', `/v1/selection-lists/${big.body.id}/items?limit=100000`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(200);
      expect(res.body.page.hasMore).toBe(true);
      expect(typeof res.body.page.nextCursor).toBe('string');
    });
    it('limit=1 pages through every item exactly once via the cursor', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const res: { status: number; body: any } = await call('get', `${L()}/items?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(res.status).toBe(200);
        expect(res.body.items.length).toBeLessThanOrEqual(1);
        seen.push(...res.body.items.map((i: { id: string }) => i.id));
        if (!res.body.page.hasMore) break;
        cursor = res.body.page.nextCursor;
      }
      expect(seen.sort()).toEqual([...itemIds].sort());
    });
  });
});
