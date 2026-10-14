// shared-lists.renderings-grants.db.test.ts - quota reporting and Security API grant tenants when ONE org is
// presented under two renderings of its id (bare UUID vs `org_...`), through the real app, real handlers and
// REAL Postgres.
//
// GRANT TENANT RULE. A list-owner grant is made in the tenant the granting token carries (the same string every
// authorization check later uses for that caller) and RECORDED in the mirror row (`selection_list_access.org_id`).
// A common list is stored under the configured platform org id, which may be the other rendering, so the stored
// `organization_id` is NOT the grant tenant. Every later revoke / confirm / compensate acts in the RECORDED
// tenant (legacy rows without it fall back to the old derivation), so a grant is never stranded in a tenant the
// cleanup does not look at.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { ADMIN_ACTIONS, createWorld, P, PLATFORM, Principal, World } from './helpers/sharedWorld';
import { flagClientWith } from './helpers/flagClient';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

const PLATFORM_UUID = toUuid(PLATFORM as never);
const THIRD: Principal = { userId: fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7e03'), orgId: PLATFORM };
const deletedEvent = (userId: string) =>
  ({ correlationId: 'c', payload: { userId: toUuid(userId as never), email: 'x@example.com', cascade: 'soft' } }) as never;

dbDescribe('quota reporting and grant tenants across renderings (real Postgres)', () => {
  let w: World;
  const opUuid: Principal = { userId: P.op.userId, orgId: PLATFORM_UUID };

  beforeAll(async () => {
    w = await createWorld(state);
    w.authz.allowCatalog(PLATFORM_UUID, P.op.userId, ADMIN_ACTIONS);
    w.authz.allowCatalog(PLATFORM, THIRD.userId, ADMIN_ACTIONS);
  });
  afterAll(() => w.teardown());

  const off = async (fn: () => Promise<void>) => {
    const { setFlagClient } = await import('../src/flags');
    setFlagClient(flagClientWith(false));
    try {
      await fn();
    } finally {
      setFlagClient(flagClientWith(true));
    }
  };

  const usage = async (p: Principal) => {
    const res = await w.api(p).get('/v1/selection-lists/quota');
    expect(res.status).toBe(200);
    return Object.fromEntries(res.body.quotas.map((q: any) => [q.scope, q])) as Record<string, { limit: number; current: number | null }>;
  };

  describe('GET /v1/selection-lists/quota', () => {
    it('a bare-UUID operator sees the usage of lists stored under the configured org_ id and the override stored under it', async () => {
      const before = (await usage(opUuid)).org_lists.current as number;
      // one published through each rendering: both are stored under the configured id
      for (const [p, key] of [[P.op, 'qr-type'], [opUuid, 'qr-uuid']] as Array<[Principal, string]>) {
        const r = await w.api(p).post('/v1/selection-lists', { key, name: key, visibility: 'platform' });
        expect(r.status).toBe(201);
        expect(r.body.organization_id).toBe(PLATFORM);
      }
      await w.db('selection_list_org_quota').insert({ organization_id: PLATFORM, updated_by: 'usr_x', max_lists: 7, max_lists_per_user: 6 });
      try {
        for (const p of [opUuid, P.op]) {
          const q = await usage(p);
          expect(q.org_lists).toMatchObject({ current: before + 2, limit: 7 });
          expect(q.user_lists).toMatchObject({ current: before + 2, limit: 6 });
        }
        const res = await w.api(opUuid).get('/v1/selection-lists/quota');
        expect(res.body.organization_id).toBe(PLATFORM_UUID); // the caller's own claim: wire contract unchanged
      } finally {
        await w.db('selection_list_org_quota').where({ organization_id: PLATFORM }).delete();
      }
    });

    it('the most restrictive override of any rendering applies, as on the write paths', async () => {
      await w.db('selection_list_org_quota').insert([
        { organization_id: PLATFORM, updated_by: 'usr_x', max_lists: 9 },
        { organization_id: PLATFORM_UUID, updated_by: 'usr_x', max_lists: 4 },
      ]);
      try {
        expect((await usage(opUuid)).org_lists.limit).toBe(4);
        expect((await usage(P.op)).org_lists.limit).toBe(4);
      } finally {
        await w.db('selection_list_org_quota').whereIn('organization_id', [PLATFORM, PLATFORM_UUID]).delete();
      }
    });

    it('the create fast-path refusal uses the same scope (an override under the TypeID id refuses a UUID-token create)', async () => {
      const current = (await usage(opUuid)).org_lists.current as number;
      await w.db('selection_list_org_quota').insert({ organization_id: PLATFORM, updated_by: 'usr_x', max_lists: current });
      try {
        const res = await w.api(opUuid).post('/v1/selection-lists', { key: 'qr-over', name: 'Over' });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'org_lists', limit: current });
      } finally {
        await w.db('selection_list_org_quota').where({ organization_id: PLATFORM }).delete();
      }
    });

    it('flag OFF: the 4.0.0 exact-id usage (the UUID token sees neither those lists nor the override)', async () => {
      await w.db('selection_list_org_quota').insert({ organization_id: PLATFORM, updated_by: 'usr_x', max_lists: 7 });
      try {
        await off(async () => {
          const q = await usage(opUuid);
          expect(q.org_lists.limit).not.toBe(7);
          const exact = await w.db('selection_lists').where({ organization_id: PLATFORM_UUID, status: 'active' }).count('id as c').first();
          expect(q.org_lists.current).toBe(Number((exact as any).c));
          expect((await usage(P.op)).org_lists.limit).toBe(7);
        });
      } finally {
        await w.db('selection_list_org_quota').where({ organization_id: PLATFORM }).delete();
      }
    });
  });

  describe('owner grants of a common list created through the OTHER rendering', () => {
    const publish = async (key: string) => {
      const r = await w.api(opUuid).post('/v1/selection-lists', { key, name: key, visibility: 'platform' });
      expect(r.status).toBe(201);
      expect(r.body.organization_id).toBe(PLATFORM); // stored under the configured org_ id...
      const mirror = await w.db('selection_list_access').where({ list_id: r.body.id, user_id: P.op.userId }).first();
      expect(mirror.org_id).toBe(PLATFORM_UUID); // ...but the grant was made, and is recorded, in the token's tenant
      expect(w.authz.grants.filter((g) => g.listId === r.body.id)).toEqual([
        { subject: P.op.userId, tenant: PLATFORM_UUID, role: 'list-owner', listId: r.body.id },
      ]);
      return r.body.id as string;
    };

    it('a purge through the OTHER rendering revokes each grant in its recorded tenant', async () => {
      const id = await publish('gr-purge');
      w.authz.give(PLATFORM, P.op.userId, id, 'list-owner'); // the TypeID-token caller holds the role in ITS tenant
      const before = w.authz.revokes.length;
      expect((await w.api(P.op).del(`/v1/selection-lists/${id}?purge=true`)).status).toBe(204);
      const mine = w.authz.revokes.slice(before).filter((r) => r.listId === id);
      expect(mine).toEqual([{ subject: P.op.userId, tenant: PLATFORM_UUID, role: 'list-owner', listId: id }]);
      expect(w.authz.roles.has(`${PLATFORM_UUID}|${P.op.userId}|${id}`)).toBe(false);
    });

    it('access DELETE removes a grant in its recorded tenant, and the last-owner guard confirms the other owner there', async () => {
      const id = await publish('gr-access');
      // a second owner, granted through the UUID rendering (mirror row + Security API role in the UUID tenant)
      await w.db('selection_list_access').insert({ list_id: id, user_id: P.opEditor.userId, role: 'list-owner', granted_by: P.op.userId, org_id: PLATFORM_UUID });
      w.authz.give(PLATFORM_UUID, P.opEditor.userId, id, 'list-owner');
      // the caller acts through the TypeID rendering and holds manage_access only in ITS tenant
      w.authz.give(PLATFORM, THIRD.userId, id, 'list-owner');
      const before = w.authz.revokes.length;
      const res = await w.api(THIRD).del(`/v1/selection-lists/${id}/access/${P.opEditor.userId}`);
      expect(res.status).toBe(204); // the other owner (op) is confirmed in the UUID tenant, where its grant is
      expect(w.authz.revokes.slice(before).filter((r) => r.listId === id)).toEqual([
        { subject: P.opEditor.userId, tenant: PLATFORM_UUID, role: 'list-owner', listId: id },
      ]);
      expect(w.authz.roles.has(`${PLATFORM_UUID}|${P.opEditor.userId}|${id}`)).toBe(false);
    });

    it('a legacy mirror row without org_id falls back to the stored organization (old behaviour)', async () => {
      const id = await publish('gr-legacy');
      await w.db('selection_list_access').where({ list_id: id }).update({ org_id: null });
      const { handleUserDeleted } = await import('../src/events/user-deleted.handler');
      const before = w.authz.revokes.length;
      await handleUserDeleted(deletedEvent(P.op.userId));
      const mine = w.authz.revokes.slice(before).filter((r) => r.listId === id);
      expect(mine).toEqual([{ subject: P.op.userId, tenant: PLATFORM, role: 'list-owner', listId: id }]);
    });

    it('identity.user.deleted revokes the grant in the tenant it was made in, then drops the mirror row', async () => {
      const id = await publish('gr-userdel');
      const { handleUserDeleted } = await import('../src/events/user-deleted.handler');
      const before = w.authz.revokes.length;
      await handleUserDeleted(deletedEvent(P.op.userId));
      const mine = w.authz.revokes.slice(before).filter((r) => r.listId === id);
      expect(mine).toEqual([{ subject: P.op.userId, tenant: PLATFORM_UUID, role: 'list-owner', listId: id }]);
      expect(w.authz.roles.has(`${PLATFORM_UUID}|${P.op.userId}|${id}`)).toBe(false); // the real grant is gone, not left behind
      expect(await w.db('selection_list_access').where({ list_id: id, user_id: P.op.userId }).first()).toBeUndefined();
    });
  });
});
