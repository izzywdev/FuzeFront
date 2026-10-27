// quota.enforcement.db.test.ts - review M-4, through the real Express app, the real
// routes/quota code and REAL Postgres (real migrations):
//
//   * `user_lists` and `list_locales` are ENFORCED where the contract says create is
//     subject to them (they were only reported before);
//   * archived rows count toward a HARD storage ceiling (active limit x factor), so
//     archive + create cannot grow the tables without bound;
//   * un-archiving is not a quota bypass.
//
// The ceilings are config-driven: per-org overrides in `selection_list_org_quota`
// and SELECTION_LISTS_STORAGE_CEILING_FACTOR for the storage multiplier.

import type { Knex } from 'knex';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';

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

const JWT_SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-quota-enforcement';
const ORG = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7f01');
const USER = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7f01');
const USER2 = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7f02');

const as = (userId: string) => ({ Authorization: `Bearer ${jwt.sign({ userId, orgId: ORG }, JWT_SECRET)}` });

dbDescribe('quota enforcement (real Postgres)', () => {
  let t: TestDb;
  let db: Knex;
  let app: ReturnType<typeof createApp>;
  let seq = 0;

  const setQuota = async (q: Record<string, number | null>) => {
    await db('selection_list_org_quota')
      .insert({ organization_id: ORG, updated_by: USER, ...q })
      .onConflict('organization_id')
      .merge();
  };
  const create = (userId = USER) =>
    request(app).post('/v1/selection-lists').set(as(userId)).send({ key: `quota-${++seq}`, name: `Quota ${seq}` });
  const patch = (id: string, body: object, userId = USER) =>
    request(app).patch(`/v1/selection-lists/${id}`).set(as(userId)).send(body);
  const archive = (id: string) => request(app).post(`/v1/selection-lists/${id}/archive`).set(as(USER));
  const purge = (id: string) => request(app).delete(`/v1/selection-lists/${id}?purge=true`).set(as(USER));
  const stored = async () => Number((await db('selection_lists').where({ organization_id: ORG }).count('* as n').first())!.n);

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
  });
  afterAll(async () => {
    setFlagClient(null);
    _setGrantTokenProviderForTesting(null);
    delete process.env.JWT_SECRET;
    delete process.env.SELECTION_LISTS_STORAGE_CEILING_FACTOR;
    await t.drop();
  });
  beforeEach(async () => {
    delete process.env.SELECTION_LISTS_STORAGE_CEILING_FACTOR;
    // empty org: children first (the access mirror and the audit rows reference the list)
    await db('selection_list_access').del();
    await db('selection_list_item_translations').del();
    await db('selection_list_items').del();
    await db('selection_list_translations').del();
    await db('selection_lists').del();
    await db('selection_list_org_quota').del();
  });

  describe('user_lists (create is subject to it, per the contract)', () => {
    it('refuses the create that would exceed the per-user ceiling with 403 QUOTA_EXCEEDED scope user_lists, and counts only the creating user', async () => {
      await setQuota({ max_lists_per_user: 2 });
      expect((await create()).status).toBe(201);
      expect((await create()).status).toBe(201);

      const refused = await create();
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'user_lists', current: 2, limit: 2 });
      expect(await stored()).toBe(2); // nothing was written

      // another user in the same org has their own allowance
      expect((await create(USER2)).status).toBe(201);
    });

    it('is exact under concurrency: N parallel creates at the ceiling admit exactly (ceiling - current)', async () => {
      await setQuota({ max_lists_per_user: 3 });
      const results = await Promise.all(Array.from({ length: 8 }, () => create()));
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status === 403).every((r) => r.body.scope === 'user_lists')).toBe(true);
      expect(await stored()).toBe(3);
    });

    it('archiving frees the user allowance; un-archiving into a full allowance is refused (no bypass)', async () => {
      await setQuota({ max_lists_per_user: 2 });
      const a = (await create()).body.id;
      await create();
      expect((await create()).status).toBe(403);

      expect((await archive(a)).status).toBe(200);
      const c = await create();
      expect(c.status).toBe(201); // active again 2/2

      const back = await patch(a, { status: 'active' });
      expect(back.status).toBe(403);
      expect(back.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'user_lists', limit: 2 });
      expect((await db('selection_lists').where({ id: a }).first('status')).status).toBe('archived');

      // freeing a slot lets it back
      expect((await archive(c.body.id)).status).toBe(200);
      expect((await patch(a, { status: 'active' })).status).toBe(200);
    });

    it('un-archiving a list that is ALREADY active is not re-checked (a no-op status write at the ceiling still succeeds)', async () => {
      await setQuota({ max_lists_per_user: 1 });
      const a = (await create()).body.id;
      expect((await patch(a, { status: 'active' })).status).toBe(200);
    });
  });

  describe('org_lists active ceiling', () => {
    it('un-archive is subject to org_lists too', async () => {
      await setQuota({ max_lists: 2 });
      const a = (await create()).body.id;
      await create(USER2);
      await archive(a);
      expect((await create(USER2)).status).toBe(201);
      const back = await patch(a, { status: 'active' });
      expect(back.status).toBe(403);
      expect(back.body.scope).toBe('org_lists');
    });
  });

  describe('hard storage ceiling: archived rows count (active limit x SELECTION_LISTS_STORAGE_CEILING_FACTOR)', () => {
    it('archive + create cannot grow the table past the ceiling, even though the ACTIVE count never moves', async () => {
      process.env.SELECTION_LISTS_STORAGE_CEILING_FACTOR = '2';
      await setQuota({ max_lists: 2 }); // storage ceiling = 4
      for (let round = 0; round < 2; round++) {
        const a = await create(USER);
        const b = await create(USER2);
        expect([a.status, b.status]).toEqual([201, 201]);
        expect((await archive(a.body.id)).status).toBe(200);
        expect((await archive(b.body.id)).status).toBe(200);
      }
      expect(await stored()).toBe(4); // 0 active, 4 archived

      const refused = await create();
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'org_lists', current: 4, limit: 4 });
      expect(refused.body.message).toMatch(/archived/i);
      expect(await stored()).toBe(4);

      // purging an archived list frees storage
      const victim = (await db('selection_lists').where({ organization_id: ORG, status: 'archived' }).first('id')).id;
      expect((await purge(victim)).status).toBe(204);
      expect((await create()).status).toBe(201);
    });

    it('the default factor is 10: a default org (100 active) may store 1000 rows, and the factor scales per-org overrides', async () => {
      const { storageCeilingFactor, DEFAULT_STORAGE_CEILING_FACTOR, DEFAULT_MAX_LISTS } = jest.requireActual('../src/services/quota.service');
      expect(DEFAULT_STORAGE_CEILING_FACTOR).toBe(10);
      expect(DEFAULT_MAX_LISTS * storageCeilingFactor({})).toBe(1000);
      expect(storageCeilingFactor({ SELECTION_LISTS_STORAGE_CEILING_FACTOR: '3' })).toBe(3);
    });

    it.each(['0', '-4', 'abc', '2.5', ''])('an invalid factor (%p) falls back to the default instead of disabling the ceiling', (bad) => {
      const { storageCeilingFactor, DEFAULT_STORAGE_CEILING_FACTOR } = jest.requireActual('../src/services/quota.service');
      expect(storageCeilingFactor({ SELECTION_LISTS_STORAGE_CEILING_FACTOR: bad })).toBe(DEFAULT_STORAGE_CEILING_FACTOR);
    });

    it('items: archived items count toward the per-list storage ceiling, purging frees it, un-archive respects list_items', async () => {
      process.env.SELECTION_LISTS_STORAGE_CEILING_FACTOR = '2';
      await setQuota({ max_items_per_list: 2 }); // active 2, stored 4
      const listId = (await create()).body.id;
      const addItem = (code: string) =>
        request(app).post(`/v1/selection-lists/${listId}/items`).set(as(USER)).send({ code, label: code });
      const archiveItem = (id: string) => request(app).post(`/v1/selection-lists/${listId}/items/${id}/archive`).set(as(USER));

      const add = async (code: string): Promise<string> => {
        const r = await addItem(code);
        expect(r.status).toBe(201);
        return r.body.id;
      };
      const a1 = await add('A1');
      const a2 = await add('A2');
      expect((await archiveItem(a1)).status).toBe(200);
      expect((await archiveItem(a2)).status).toBe(200);
      const b1 = await add('B1');
      const b2 = await add('B2');
      expect((await archiveItem(b2)).status).toBe(200);
      // active 1 (< 2) but STORED 4 (= the ceiling): only the storage ceiling can refuse now
      const refused = await addItem('C1');
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_items', current: 4, limit: 4 });
      expect(refused.body.message).toMatch(/archived/i);

      // un-archiving respects the ACTIVE ceiling (2): one more fits, the next does not
      const patchItem = (id: string, body: object) =>
        request(app).patch(`/v1/selection-lists/${listId}/items/${id}`).set(as(USER)).send(body);
      expect((await patchItem(a1, { status: 'active' })).status).toBe(200);
      const back = await patchItem(a2, { status: 'active' });
      expect(back.status).toBe(403);
      expect(back.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_items', limit: 2 });
      expect((await db('selection_list_items').where({ id: a2 }).first('status')).status).toBe('archived');

      // purging an archived item frees stored space: archive one active, then there is room again
      const purged = await request(app).delete(`/v1/selection-lists/${listId}/items/${a2}?purge=true`).set(as(USER));
      expect(purged.status).toBe(204);
      expect((await archiveItem(b1)).status).toBe(200); // active 1 (a1), stored 3
      expect((await addItem('C1')).status).toBe(201);
    });
  });

  describe('list_locales (adding a locale is subject to it)', () => {
    const put = (id: string, locale: string, name = `n-${locale}`) =>
      request(app).put(`/v1/selection-lists/${id}/translations/${locale}`).set(as(USER)).send({ name });
    const autofill = (id: string, locale: string) =>
      request(app).post(`/v1/selection-lists/${id}/translations/${locale}/autofill`).set(as(USER)).send({});

    it('PUT: the source locale counts; a new locale over the ceiling is 403 list_locales; updating an existing locale is always allowed', async () => {
      await setQuota({ max_locales: 2 });
      const id = (await create()).body.id; // en (source) = 1
      expect((await put(id, 'fr')).status).toBe(200); // 2

      const refused = await put(id, 'de');
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_locales', current: 2, limit: 2 });
      expect(await db('selection_list_translations').where({ list_id: id, locale: 'de' }).first()).toBeUndefined();

      expect((await put(id, 'fr', 'Pays')).status).toBe(200); // existing locale: an update, not an addition

      // removing a locale frees the slot
      expect((await request(app).delete(`/v1/selection-lists/${id}/translations/fr`).set(as(USER))).status).toBe(204);
      expect((await put(id, 'de')).status).toBe(200);
    });

    it('autofill into a new locale over the ceiling is refused and writes nothing; refreshing an existing locale is allowed', async () => {
      await setQuota({ max_locales: 2 });
      const id = (await create()).body.id;
      await request(app).post(`/v1/selection-lists/${id}/items`).set(as(USER)).send({ code: 'X', label: 'X' });
      expect((await autofill(id, 'fr')).status).toBe(200);

      const refused = await autofill(id, 'de');
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'list_locales' });
      expect(await db('selection_list_translations').where({ list_id: id, locale: 'de' }).first()).toBeUndefined();
      expect(await db('selection_list_item_translations').where({ locale: 'de' }).first()).toBeUndefined();

      expect((await autofill(id, 'fr')).status).toBe(200);
    });

    it('a PATCH that moves the source locale to a new one adds a locale and is refused at the ceiling', async () => {
      await setQuota({ max_locales: 1 });
      const id = (await create()).body.id; // en = 1/1
      const refused = await patch(id, { source_locale: 'fr', name: 'Pays' });
      expect(refused.status).toBe(403);
      expect(refused.body.scope).toBe('list_locales');
      expect((await db('selection_lists').where({ id }).first('source_locale')).source_locale).toBe('en'); // rolled back
    });

    it('with the default ceiling (11 = every supported locale) nothing is ever refused', async () => {
      const id = (await create()).body.id;
      for (const l of ['es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'hi', 'ar', 'he']) {
        expect((await put(id, l)).status).toBe(200);
      }
    });
  });
});
