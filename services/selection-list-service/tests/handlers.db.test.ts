// handlers.db.test.ts — the lifecycle handlers against REAL Postgres, with the
// real migrations (review M-3 / blocker B7: "mocked-knex tests cannot catch a
// wrong column name, which is how this shipped").
//
// Isolation: each run creates its own schema (search_path pinned on every pooled
// connection), runs src/db/migrations into it, and drops it afterwards, so it
// can share a database with anything else.
//
// Where it runs:
//   - CI sets SLS_TEST_DATABASE_URL (a postgres service container on the unit
//     job) and CI=true. In CI a missing DB is a FAILURE, never a skip.
//   - Locally, without SLS_TEST_DATABASE_URL the suite is skipped with a loud
//     warning, so `npx jest` still works on a laptop with no Postgres.

import knexFactory, { Knex } from 'knex';
import path from 'path';
import { randomBytes } from 'crypto';
import { fromUuid } from '@izzywdev/fuzefront-identity';

const URL_ENV = process.env.SLS_TEST_DATABASE_URL;
const inCI = Boolean(process.env.CI);

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

import { handleOrgDeleted } from '../src/events/org-deleted.handler';
import { handleUserDeleted } from '../src/events/user-deleted.handler';

const suite = URL_ENV ? describe : inCI ? describe : describe.skip;

if (!URL_ENV) {
  if (inCI) {
    describe('handlers.db (CI requires a database)', () => {
      it('SLS_TEST_DATABASE_URL must be set in CI — the DB-backed handler tests are not optional', () => {
        throw new Error('SLS_TEST_DATABASE_URL is not set but CI=true: add the postgres service to the unit job.');
      });
    });
  } else {
    // eslint-disable-next-line no-console
    console.warn('[handlers.db.test] SKIPPED: set SLS_TEST_DATABASE_URL to run the real-Postgres handler tests.');
  }
}

const ORG_A_UUID = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c8d';
const ORG_A = fromUuid('organization', ORG_A_UUID); // as stored: the TypeID from the token
const ORG_B = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-000000000002');
const USER_UUID = '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7c8d';
const USER = fromUuid('user', USER_UUID);
const OTHER_USER = fromUuid('user', '0195a8f2-bbbb-7a11-8b2d-000000000003');

const orgEvent = (organizationId: string, cascade: 'soft' | 'hard') =>
  ({ correlationId: 'c', payload: { organizationId, slug: 's', ownerId: null, cascade } }) as any;
const userEvent = (userId: string) =>
  ({ correlationId: 'c', payload: { userId, email: 'x@example.com', cascade: 'soft' } }) as any;

suite('lifecycle handlers on real Postgres', () => {
  let db: Knex;
  const schema = `slt_${randomBytes(6).toString('hex')}`;

  beforeAll(async () => {
    const admin = knexFactory({ client: 'pg', connection: URL_ENV, pool: { min: 1, max: 1 } });
    await admin.raw(`CREATE SCHEMA ${schema}`);
    await admin.destroy();

    db = knexFactory({
      client: 'pg',
      connection: URL_ENV,
      searchPath: [schema],
      pool: { min: 1, max: 4 },
      migrations: {
        directory: path.join(__dirname, '..', 'src', 'db', 'migrations'),
        extension: 'ts',
        loadExtensions: ['.ts'],
      },
    });
    await db.migrate.latest();
    state.db = db;
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
      const admin = knexFactory({ client: 'pg', connection: URL_ENV, pool: { min: 1, max: 1 } });
      await admin.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.destroy();
    }
  });

  /** One org's worth of data touching every table the handler must clear. */
  async function seedOrg(org: string, tag: string, owner: string): Promise<{ listId: string; itemId: string }> {
    const listId = `front_sl_${tag}list`;
    const itemId = `front_sli_${tag}item`;
    await db('selection_lists').insert({ id: listId, organization_id: org, key: `k_${tag}`, created_by: owner });
    await db('selection_list_items').insert({ id: itemId, list_id: listId, code: 'C', sort_order: 1, created_by: owner });
    await db('selection_list_translations').insert({ list_id: listId, locale: 'en', name: 'N' });
    await db('selection_list_item_translations').insert({ item_id: itemId, locale: 'en', label: 'L' });
    await db('selection_list_access').insert({ list_id: listId, user_id: owner, role: 'list-owner', granted_by: owner });
    await db('selection_list_audit').insert([
      { id: `aud_${tag}1`, list_id: listId, actor_id: owner, action: 'list.create' },
      { id: `aud_${tag}2`, list_id: null, item_id: itemId, actor_id: owner, action: 'item.create' }, // item-only row
    ]);
    await db('selection_list_org_quota').insert({ organization_id: org, max_lists: 5, updated_by: owner });
    return { listId, itemId };
  }

  const counts = async (org: string) => {
    const lists = await db('selection_lists').where({ organization_id: org }).select('id', 'status');
    const ids = lists.map((l: any) => l.id);
    const n = async (t: string, col: string) =>
      Number((await db(t).whereIn(col, ids.length ? ids : ['__none__']).count('* as n').first())?.n ?? 0);
    return {
      lists: lists.length,
      archived: lists.filter((l: any) => l.status === 'archived').length,
      items: await n('selection_list_items', 'list_id'),
      listTranslations: await n('selection_list_translations', 'list_id'),
      access: await n('selection_list_access', 'list_id'),
      audit: await n('selection_list_audit', 'list_id'),
      quota: Number((await db('selection_list_org_quota').where({ organization_id: org }).count('* as n').first())?.n ?? 0),
    };
  };

  beforeEach(async () => {
    for (const t of [
      'selection_list_audit',
      'selection_list_item_translations',
      'selection_list_translations',
      'selection_list_access',
      'selection_list_items',
      'selection_lists',
      'selection_list_org_quota',
    ]) {
      await db(t).delete();
    }
  });

  describe('identity.org.deleted — hard', () => {
    it('removes every row of the org (FK-safe, incl. item-only audit rows + quota), leaves other orgs alone, and replays as a no-op', async () => {
      await seedOrg(ORG_A, 'a', USER);
      await seedOrg(ORG_B, 'b', OTHER_USER);
      expect(await counts(ORG_A)).toMatchObject({ lists: 1, items: 1, access: 1, quota: 1 });

      // The event carries the bare UUID; the rows store the org_ TypeID.
      await handleOrgDeleted(orgEvent(ORG_A_UUID, 'hard'));

      expect(await counts(ORG_A)).toEqual({ lists: 0, archived: 0, items: 0, listTranslations: 0, access: 0, audit: 0, quota: 0 });
      expect(await db('selection_list_audit').where({ action: 'item.create', actor_id: USER }).count('* as n').first()).toMatchObject({ n: '0' });
      expect(await counts(ORG_B)).toMatchObject({ lists: 1, items: 1, listTranslations: 1, access: 1, audit: 1, quota: 1 });

      await expect(handleOrgDeleted(orgEvent(ORG_A_UUID, 'hard'))).resolves.toBeUndefined(); // idempotent
      expect(await counts(ORG_B)).toMatchObject({ lists: 1 });
    });

    it('also clears a quota override row for an org that has no lists', async () => {
      await db('selection_list_org_quota').insert({ organization_id: ORG_A, max_lists: 1, updated_by: USER });
      await handleOrgDeleted(orgEvent(ORG_A_UUID, 'hard'));
      expect((await counts(ORG_A)).quota).toBe(0);
    });

    it('matches an org stored in the bare-UUID form too', async () => {
      await seedOrg(ORG_A_UUID, 'u', USER);
      await handleOrgDeleted(orgEvent(ORG_A_UUID, 'hard'));
      expect((await counts(ORG_A_UUID)).lists).toBe(0);
    });
  });

  describe('identity.org.deleted — soft', () => {
    it('archives the org\'s lists (status column), deletes nothing, keeps the quota row, leaves other orgs alone, replays as a no-op', async () => {
      await seedOrg(ORG_A, 'a', USER);
      await seedOrg(ORG_B, 'b', OTHER_USER);

      await handleOrgDeleted(orgEvent(ORG_A_UUID, 'soft'));

      expect(await counts(ORG_A)).toMatchObject({ lists: 1, archived: 1, items: 1, listTranslations: 1, access: 1, audit: 1, quota: 1 });
      expect(await counts(ORG_B)).toMatchObject({ lists: 1, archived: 0 });

      const before = await db('selection_lists').where({ organization_id: ORG_A }).first('updated_at');
      await handleOrgDeleted(orgEvent(ORG_A_UUID, 'soft'));
      const after = await db('selection_lists').where({ organization_id: ORG_A }).first('updated_at');
      expect(after.updated_at).toEqual(before.updated_at); // second replay touched nothing
    });
  });

  describe('identity.user.deleted', () => {
    it('anonymises created_by / granted_by (the real columns) for both id renderings and leaves other users alone', async () => {
      const a = await seedOrg(ORG_A, 'a', USER);
      await seedOrg(ORG_B, 'b', OTHER_USER);
      // a row authored under the bare-UUID rendering as well
      await db('selection_list_items').insert({ id: 'front_sli_aaitem2', list_id: a.listId, code: 'D', sort_order: 2, created_by: USER_UUID });

      await handleUserDeleted(userEvent(USER_UUID));

      expect(await db('selection_lists').where({ created_by: '[deleted-user]' }).count('* as n').first()).toMatchObject({ n: '1' });
      expect(await db('selection_list_items').where({ created_by: '[deleted-user]' }).count('* as n').first()).toMatchObject({ n: '2' });
      expect(await db('selection_list_access').where({ granted_by: '[deleted-user]' }).count('* as n').first()).toMatchObject({ n: '1' });
      expect(await db('selection_lists').where({ created_by: OTHER_USER }).count('* as n').first()).toMatchObject({ n: '1' });
      await expect(handleUserDeleted(userEvent(USER_UUID))).resolves.toBeUndefined(); // idempotent
    });
  });
});
