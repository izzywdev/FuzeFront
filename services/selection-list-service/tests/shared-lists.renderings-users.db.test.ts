// shared-lists.renderings-users.db.test.ts - ONE user, two renderings of their id (`usr_...` TypeID vs bare UUID).
//
// The auth middleware passes the token's `userId`/`sub` verbatim and `created_by` / the access mirror's `user_id`
// store whatever it was, so with shared lists ON every comparison of "this user" must hold across renderings:
// the per-user quota (`user_lists`) on create, fork, un-archive and the usage report, and the access routes'
// grant lookup / last-owner guard. Flag OFF is the 4.0.0 exact match. Real app, real handlers, real Postgres.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import { createWorld, EDITOR_ACTIONS as EDITOR, Principal, publishPriorityList, World } from './helpers/sharedWorld';
import { flagClientWith } from './helpers/flagClient';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

const orgOf = (n: string) => fromUuid('organization', `0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7${n}`);
const userT = (n: string) => fromUuid('user', `0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7${n}`);

dbDescribe('one user under two renderings of their id (real Postgres)', () => {
  let w: World;
  let platform: { listId: string; low: string; mid: string; old: string };
  let seq = 0;

  beforeAll(async () => {
    w = await createWorld(state);
    platform = await publishPriorityList(w);
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

  /** A fresh org with a per-user ceiling of 2, one user in both renderings, and another user. */
  const world = async () => {
    const n = String(100 + ++seq).padStart(3, '0');
    const org = orgOf(`${n}`);
    const t = userT(`${n}`);
    const u = toUuid(t as never);
    const other = userT(`9${n.slice(1)}`);
    const byT: Principal = { userId: t, orgId: org };
    const byU: Principal = { userId: u, orgId: org };
    const byOther: Principal = { userId: other, orgId: org };
    for (const p of [byT, byU, byOther]) w.authz.allowCatalog(org, p.userId, [...EDITOR, 'read_quota']);
    await w.db('selection_list_org_quota').insert({ organization_id: org, updated_by: 'usr_x', max_lists_per_user: 2 });
    return { org, byT, byU, byOther };
  };
  const mk = async (p: Principal, key: string) => {
    const r = await w.api(p).post('/v1/selection-lists', { key, name: key });
    return r;
  };

  describe.each([
    ['usr_ then UUID', (x: Awaited<ReturnType<typeof world>>) => [x.byT, x.byU] as const],
    ['UUID then usr_', (x: Awaited<ReturnType<typeof world>>) => [x.byU, x.byT] as const],
  ])('%s', (_name, order) => {
    it('create: lists made under one rendering count toward the per-user ceiling of the other', async () => {
      const x = await world();
      const [first, second] = order(x);
      expect((await mk(first, `pu-${seq}-a`)).status).toBe(201);
      expect((await mk(first, `pu-${seq}-b`)).status).toBe(201);
      const refused = await mk(second, `pu-${seq}-c`);
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'user_lists', limit: 2 });
      // the same rendering is refused too (control), the OTHER user never matches
      expect((await mk(first, `pu-${seq}-d`)).status).toBe(403);
      expect((await mk(x.byOther, `pu-${seq}-o`)).status).toBe(201);
    });

    it('fork: the copy counts against, and is refused by, the ceiling reached under the other rendering', async () => {
      const x = await world();
      const [first, second] = order(x);
      expect((await mk(first, `pf-${seq}-a`)).status).toBe(201);
      expect((await mk(first, `pf-${seq}-b`)).status).toBe(201);
      const refused = await w.api(second).post(`/v1/selection-lists/${platform.listId}/fork`, {});
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'user_lists' });
      expect(await w.db('selection_lists').where({ forked_from_list_id: platform.listId }).whereIn('organization_id', [x.org]).first()).toBeUndefined();
      // another user of the same org is not affected
      expect((await w.api(x.byOther).post(`/v1/selection-lists/${platform.listId}/fork`, {})).status).toBe(201);
    });

    it('usage report: user_lists.current counts both renderings', async () => {
      const x = await world();
      const [first, second] = order(x);
      expect((await mk(first, `pq-${seq}-a`)).status).toBe(201);
      expect((await mk(second, `pq-${seq}-b`)).status).toBe(201);
      for (const p of [first, second]) {
        const q = (await w.api(p).get('/v1/selection-lists/quota')).body.quotas.find((e: any) => e.scope === 'user_lists');
        expect(q).toMatchObject({ current: 2, limit: 2 });
      }
      const other = (await w.api(x.byOther).get('/v1/selection-lists/quota')).body.quotas.find((e: any) => e.scope === 'user_lists');
      expect(other.current).toBe(0);
    });

    it('un-archive: re-activating a list authored under the other rendering is held to the ceiling', async () => {
      const x = await world();
      const [first, second] = order(x);
      const a = await mk(first, `pa-${seq}-a`);
      expect(a.status).toBe(201);
      expect((await w.api(first).post(`/v1/selection-lists/${a.body.id}/archive`)).status).toBe(200);
      expect((await mk(first, `pa-${seq}-b`)).status).toBe(201);
      expect((await mk(second, `pa-${seq}-c`)).status).toBe(201); // two ACTIVE now (one per rendering), `a` is archived
      w.authz.give(x.org, second.userId, a.body.id, 'list-owner');
      const res = await w.api(second).patch(`/v1/selection-lists/${a.body.id}`, { status: 'active' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'QUOTA_EXCEEDED', scope: 'user_lists' });
    });
  });

  it('flag OFF: the 4.0.0 exact match (each rendering is its own user)', async () => {
    const x = await world();
    await off(async () => {
      expect((await mk(x.byT, `off-${seq}-a`)).status).toBe(201);
      expect((await mk(x.byT, `off-${seq}-b`)).status).toBe(201);
      expect((await mk(x.byT, `off-${seq}-c`)).status).toBe(403);
      expect((await mk(x.byU, `off-${seq}-d`)).status).toBe(201); // a different stored string
    });
  });

  describe('access routes: the grant mirror holds the UUID rendering (created through a bare-UUID token)', () => {
    /** A list created through the UUID rendering; the caller path names the user by the `usr_` TypeID. */
    const setup = async () => {
      const x = await world();
      const made = await mk(x.byU, `ac-${seq}`);
      expect(made.status).toBe(201);
      const listId: string = made.body.id;
      const mirror = await w.db('selection_list_access').where({ list_id: listId }).first();
      expect(mirror.user_id).toBe(x.byU.userId); // stored verbatim (UUID)
      // the Security API membership probe (`Organization:read`) passes for the targets used below
      for (const u of [x.byT.userId, x.byU.userId, x.byOther.userId]) w.authz.roles.set(`${x.org}|${u}|undefined`, 'list-viewer');
      return { ...x, listId };
    };
    const second = (x: Awaited<ReturnType<typeof setup>>) => {
      // another owner, granted through the usr_ rendering of ANOTHER user
      return w.db('selection_list_access').insert({ list_id: x.listId, user_id: x.byOther.userId, role: 'list-owner', granted_by: x.byU.userId, org_id: x.org }).then(() => {
        w.authz.give(x.org, x.byOther.userId, x.listId, 'list-owner');
      });
    };

    it('the last-owner guard finds the creator by the usr_ path id: removing / demoting the only owner is 409', async () => {
      const x = await setup();
      const del = await w.api(x.byU).del(`/v1/selection-lists/${x.listId}/access/${x.byT.userId}`);
      expect(del.status).toBe(409);
      const demote = await w.api(x.byU).put(`/v1/selection-lists/${x.listId}/access/${x.byT.userId}`, { role: 'list-editor' });
      expect(demote.status).toBe(409);
      expect(await w.db('selection_list_access').where({ list_id: x.listId })).toHaveLength(1); // no second row for the same user
    });

    it('with another owner: a role change reuses the existing grant (no duplicate row, recorded subject) and is reported as usr_', async () => {
      const x = await setup();
      await second(x);
      const before = w.authz.revokes.length;
      const res = await w.api(x.byU).put(`/v1/selection-lists/${x.listId}/access/${x.byT.userId}`, { role: 'list-editor' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ user_id: x.byT.userId, role: 'list-editor' });
      const rows = await w.db('selection_list_access').where({ list_id: x.listId }).orderBy('user_id');
      expect(rows.filter((r: any) => r.role === 'list-editor')).toHaveLength(1);
      expect(rows).toHaveLength(2); // the creator's ONE row (still keyed by the UUID) + the other owner
      expect(rows.find((r: any) => r.role === 'list-editor').user_id).toBe(x.byU.userId);
      expect(w.authz.revokes.slice(before).map((r) => [r.subject, r.role])).toEqual([[x.byU.userId, 'list-owner']]); // revoked as granted
    });

    it('DELETE removes the grant by its recorded subject; the guard counts the OTHER owner, never the target', async () => {
      const x = await setup();
      await second(x);
      const before = w.authz.revokes.length;
      // the creator removes themselves (named by the usr_ TypeID): allowed, because another owner is confirmed
      const res = await w.api(x.byU).del(`/v1/selection-lists/${x.listId}/access/${x.byT.userId}`);
      expect(res.status).toBe(204);
      expect(w.authz.revokes.slice(before).map((r) => [r.subject, r.role])).toEqual([[x.byU.userId, 'list-owner']]);
      expect((await w.db('selection_list_access').where({ list_id: x.listId, user_id: x.byU.userId }).first()).revoked_at).not.toBeNull();
    });

    it('GET renders every grantee as a usr_ TypeID', async () => {
      const x = await setup();
      const res = await w.api(x.byU).get(`/v1/selection-lists/${x.listId}/access`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: any) => i.user_id)).toEqual([x.byT.userId]);
    });

    it('flag OFF: the 4.0.0 exact lookup (the usr_ path id does not find a UUID-keyed grant: idempotent 204)', async () => {
      const x = await setup();
      await off(async () => {
        const del = await w.api(x.byU).del(`/v1/selection-lists/${x.listId}/access/${x.byT.userId}`);
        expect(del.status).toBe(204);
      });
      expect((await w.db('selection_list_access').where({ list_id: x.listId, user_id: x.byU.userId }).first()).revoked_at).toBeNull();
    });
  });
});
