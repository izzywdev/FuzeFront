// shared-lists.access-groups.db.test.ts - ONE logical grant per user.
//
// A list that predates the rendering-aware code can hold mirror rows for BOTH renderings of one user (the bare UUID
// and the `usr_...` TypeID): the (list_id, user_id) key is exact. The rows are one GRANT GROUP:
//   - DELETE revokes every row (mirror and authority, each with its recorded subject / tenant / role);
//   - PUT converges the group to exactly ONE live row with the new role (every other role revoked);
//   - the last-owner guard treats the pair as ONE owner (and a user as an owner when ANY row is);
//   - GET lists the user once (the deterministic survivor: Permit key form, oldest, smallest id);
//   - a failure after an authority write re-grants EVERY role the request revoked.
// Real Postgres, real handlers, real app.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { toUuid } from '@izzywdev/fuzefront-identity';
import { createWorld, ORG_A, P, World } from './helpers/sharedWorld';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('a user holding mirror rows under BOTH renderings is ONE grant (real Postgres)', () => {
  let w: World;
  let n = 0;
  const ORG_UUID = toUuid(ORG_A as never);
  const TARGET_TYPE = P.aMember.userId; // usr_...
  const TARGET_UUID = toUuid(P.aMember.userId as never);

  beforeAll(async () => {
    w = await createWorld(state);
    w.authz.member(ORG_A, P.aMember.userId);
  });
  afterAll(() => w.teardown());

  /** A list owned by aAdmin where the target holds a row per rendering (`uuidRole` / `typeRole`). */
  const listWithPair = async (uuidRole: string, typeRole: string) => {
    const made = await w.api(P.aAdmin).post('/v1/selection-lists', { key: `pair-${++n}`, name: 'Pair' });
    expect(made.status).toBe(201);
    const listId: string = made.body.id;
    await w.db('selection_lists').where({ id: listId }).update({ created_by: 'system' }); // out of the per-user quota
    const base = { list_id: listId, granted_by: P.aAdmin.userId, org_id: ORG_UUID };
    await w.db('selection_list_access').insert([
      { ...base, user_id: TARGET_UUID, role: uuidRole, granted_at: new Date('2026-01-02T00:00:00Z') },
      { ...base, user_id: TARGET_TYPE, role: typeRole, granted_at: new Date('2026-01-01T00:00:00Z') }, // OLDER, but not the Permit key form
    ]);
    w.authz.give(ORG_A, P.aMember.userId, listId, uuidRole); // the authority holds the survivor's role (the fake has one slot per key)
    return { listId, L: `/v1/selection-lists/${listId}` };
  };
  const live = (listId: string) => w.db('selection_list_access').where({ list_id: listId }).whereIn('user_id', [TARGET_UUID, TARGET_TYPE]).whereNull('revoked_at');
  const rows = (listId: string) => w.db('selection_list_access').where({ list_id: listId }).whereIn('user_id', [TARGET_UUID, TARGET_TYPE]).orderBy('user_id');

  const COMBOS: Array<[string, string]> = [
    ['list-owner', 'list-owner'],
    ['list-owner', 'list-viewer'],
    ['list-viewer', 'list-owner'],
    ['list-viewer', 'list-viewer'],
    ['list-editor', 'list-viewer'],
  ];

  describe.each(COMBOS)('rows: bare UUID = %s, usr_ = %s', (uuidRole, typeRole) => {
    it('DELETE revokes EVERY row: no live mirror row, no authority grant, one revoke per row with its own role', async () => {
      const { listId, L } = await listWithPair(uuidRole, typeRole);
      const before = w.authz.revokes.length;
      const res = await w.api(P.aAdmin).del(`${L}/access/${TARGET_TYPE}`);
      expect(res.status).toBe(204);
      expect(await live(listId)).toHaveLength(0);
      expect((await rows(listId)).every((r: any) => r.revoked_at !== null)).toBe(true);
      expect(w.authz.roleOf(ORG_A, P.aMember.userId, listId)).toBeUndefined();
      const mine = w.authz.revokes.slice(before).filter((r) => r.listId === listId);
      expect(mine.map((r) => r.role).sort()).toEqual([uuidRole, typeRole].sort());
      // GET shows nobody for the target
      const list = await w.api(P.aAdmin).get(`${L}/access`);
      expect(list.body.items.filter((g: any) => g.user_id === TARGET_TYPE)).toHaveLength(0);
    });

    it('PUT converges the group to exactly ONE live row with the new role; every other role is revoked', async () => {
      const { listId, L } = await listWithPair(uuidRole, typeRole);
      const before = w.authz.revokes.length;
      const res = await w.api(P.aAdmin).put(`${L}/access/${TARGET_TYPE}`, { role: 'list-translator' });
      expect(res.status).toBe(200);
      const liveRows = await live(listId);
      expect(liveRows.map((r: any) => ({ u: r.user_id, r: r.role }))).toEqual([{ u: TARGET_UUID, r: 'list-translator' }]); // the survivor
      expect(w.authz.roleOf(ORG_A, P.aMember.userId, listId)).toBe('list-translator');
      const revoked = w.authz.revokes.slice(before).filter((r) => r.listId === listId).map((r) => r.role).sort();
      expect(revoked).toEqual([...new Set([uuidRole, typeRole])].sort());
      // one entry for the user over HTTP
      const list = await w.api(P.aAdmin).get(`${L}/access`);
      const mineEntries = list.body.items.filter((g: any) => g.user_id === TARGET_TYPE);
      expect(mineEntries).toHaveLength(1);
      expect(mineEntries[0].role).toBe('list-translator');
    });
  });

  it('PUT of the role every row already holds converges to one row without revoking anything', async () => {
    const { listId, L } = await listWithPair('list-viewer', 'list-viewer');
    const before = w.authz.revokes.length;
    expect((await w.api(P.aAdmin).put(`${L}/access/${TARGET_TYPE}`, { role: 'list-viewer' })).status).toBe(200);
    expect(await live(listId)).toHaveLength(1);
    expect(w.authz.revokes.slice(before).filter((r) => r.listId === listId)).toHaveLength(0);
  });

  describe('GET lists the user once, at its survivor', () => {
    it('one entry (the Permit-key-form row wins even though the other is older), across pages', async () => {
      const { L } = await listWithPair('list-editor', 'list-viewer');
      const seen: any[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: any = await w.api(P.aAdmin).get(`${L}/access?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
        expect(res.status).toBe(200);
        seen.push(...res.body.items);
        cursor = res.body.page.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);
      const ids = seen.map((g) => g.user_id);
      expect(new Set(ids).size).toBe(ids.length); // nobody twice
      expect(ids).toContain(TARGET_TYPE);
      expect(seen.find((g) => g.user_id === TARGET_TYPE).role).toBe('list-editor'); // the survivor's role
      expect(ids).toContain(P.aAdmin.userId); // the creator's owner row is still there
    });
  });

  describe('the last-owner guard counts LOGICAL owners', () => {
    it('the target pair (both rows owner) is the ONLY owner and demotes itself: 409, nothing changes', async () => {
      const { listId, L } = await listWithPair('list-owner', 'list-owner');
      // the creator is no longer an owner anywhere
      await w.db('selection_list_access').where({ list_id: listId, user_id: toUuid(P.aAdmin.userId as never) }).delete();
      w.authz.dropRole(ORG_A, P.aAdmin.userId, listId);
      const before = await rows(listId);
      const grants = w.authz.grants.length;
      const revokes = w.authz.revokes.length;
      const res = await w.api(P.aMember).put(`${L}/access/${TARGET_TYPE}`, { role: 'list-viewer' });
      expect(res.status).toBe(409);
      expect(await rows(listId)).toEqual(before);
      expect(w.authz.grants).toHaveLength(grants);
      expect(w.authz.revokes).toHaveLength(revokes);
      // and removing the sole (pair) owner is refused too
      expect((await w.api(P.aMember).del(`${L}/access/${TARGET_TYPE}`)).status).toBe(409);
      expect(await rows(listId)).toEqual(before);
    });

    it('a user is an owner when ANY row of its group is: demoting a (viewer row, owner row) pair needs another confirmed owner', async () => {
      const { listId, L } = await listWithPair('list-viewer', 'list-owner');
      await w.db('selection_list_access').where({ list_id: listId, user_id: toUuid(P.aAdmin.userId as never) }).delete();
      w.authz.dropRole(ORG_A, P.aAdmin.userId, listId);
      w.authz.give(ORG_A, P.aMember.userId, listId, 'list-owner'); // the authority knows the user as the owner
      const res = await w.api(P.aMember).del(`${L}/access/${TARGET_TYPE}`);
      expect(res.status).toBe(409);
      expect(await live(listId)).toHaveLength(2);
    });

    it('PUT: a (viewer row = survivor, owner row) pair is an owner too - demoting it with no other confirmed owner is refused, nothing written', async () => {
      const { listId, L } = await listWithPair('list-viewer', 'list-owner');
      await w.db('selection_list_access').where({ list_id: listId, user_id: toUuid(P.aAdmin.userId as never) }).delete();
      w.authz.dropRole(ORG_A, P.aAdmin.userId, listId);
      w.authz.give(ORG_A, P.aMember.userId, listId, 'list-owner'); // the authority knows the user as the owner (the caller)
      const before = await rows(listId);
      const grants = w.authz.grants.length;
      const revokes = w.authz.revokes.length;
      const res = await w.api(P.aMember).put(`${L}/access/${TARGET_TYPE}`, { role: 'list-editor' });
      expect(res.status).toBe(409);
      expect(await rows(listId)).toEqual(before);
      expect(w.authz.grants).toHaveLength(grants);
      expect(w.authz.revokes).toHaveLength(revokes);
    });

    it('the pair is ONE owner for the OTHER users: another owner still exists, so the target may be removed', async () => {
      const { listId, L } = await listWithPair('list-owner', 'list-owner'); // the creator (aAdmin) is also an owner
      expect((await w.api(P.aAdmin).del(`${L}/access/${TARGET_TYPE}`)).status).toBe(204);
      expect(await live(listId)).toHaveLength(0);
    });

    it('hasConfirmedOtherOwner asks the authority ONCE for a pair of owner rows', async () => {
      const { listId } = await listWithPair('list-owner', 'list-owner');
      await w.db('selection_list_access').where({ list_id: listId, user_id: toUuid(P.aAdmin.userId as never) }).delete();
      const { hasConfirmedOtherOwner } = await import('../src/services/authority');
      const { logger } = await import('../src/lib/logger');
      const mark = w.authz.asked.length;
      const confirmed = await hasConfirmedOtherOwner({ executor: w.db, listId, orgId: ORG_A, excludeUserIds: [], token: 't', log: logger });
      expect(confirmed).toBe(true);
      const probes = w.authz.asked.slice(mark).filter((q) => q.action === 'manage_access' && q.resource.key === listId);
      expect(probes).toHaveLength(1);
    });
  });

  describe('revoked rows', () => {
    it('re-granting a user whose rows are ALL revoked re-activates the survivor only, deterministically', async () => {
      const { listId, L } = await listWithPair('list-viewer', 'list-viewer');
      expect((await w.api(P.aAdmin).del(`${L}/access/${TARGET_TYPE}`)).status).toBe(204);
      expect(await live(listId)).toHaveLength(0);
      expect((await w.api(P.aAdmin).put(`${L}/access/${TARGET_TYPE}`, { role: 'list-editor' })).status).toBe(200);
      expect((await live(listId)).map((r: any) => ({ u: r.user_id, r: r.role }))).toEqual([{ u: TARGET_UUID, r: 'list-editor' }]);
      expect((await w.db('selection_list_access').where({ list_id: listId, user_id: TARGET_TYPE }).first()).revoked_at).not.toBeNull();
    });
  });

  describe('compensation re-grants EVERY role the request revoked', () => {
    it('a grant that fails after both roles were revoked restores both roles in the authority; the mirror is unchanged', async () => {
      const { _setAuthzClientForTesting } = await import('../src/middleware/authz');
      const { listId, L } = await listWithPair('list-viewer', 'list-editor');
      const base = w.authz.asAuthzClient();
      let grantCalls = 0;
      _setAuthzClientForTesting({
        ...base,
        grant: async (...a: Parameters<typeof base.grant>) => {
          if (++grantCalls === 1) throw new Error('provider down'); // the new role's grant fails, compensation succeeds
          return base.grant(...a);
        },
      } as never);
      const grantsBefore = w.authz.grants.length;
      try {
        const res = await w.api(P.aAdmin).put(`${L}/access/${TARGET_TYPE}`, { role: 'list-translator' });
        expect(res.status).toBe(500);
      } finally {
        _setAuthzClientForTesting(base);
      }
      const regranted = w.authz.grants.slice(grantsBefore).filter((g) => g.listId === listId).map((g) => g.role).sort();
      expect(regranted).toEqual(['list-editor', 'list-viewer']); // both prior roles, not just the survivor's
      expect((await rows(listId)).map((r: any) => ({ u: r.user_id, r: r.role, rev: r.revoked_at }))).toEqual(
        [{ u: TARGET_UUID, r: 'list-viewer', rev: null }, { u: TARGET_TYPE, r: 'list-editor', rev: null }].sort((a, b) => (a.u < b.u ? -1 : 1)),
      );
    });

    it('a DELETE whose second revoke fails re-grants the first row\'s role too', async () => {
      const { _setAuthzClientForTesting } = await import('../src/middleware/authz');
      const { listId, L } = await listWithPair('list-viewer', 'list-editor');
      const base = w.authz.asAuthzClient();
      let revokeCalls = 0;
      _setAuthzClientForTesting({
        ...base,
        revoke: async (...a: Parameters<typeof base.revoke>) => {
          if (++revokeCalls === 2) throw new Error('provider down');
          return base.revoke(...a);
        },
      } as never);
      const grantsBefore = w.authz.grants.length;
      try {
        expect((await w.api(P.aAdmin).del(`${L}/access/${TARGET_TYPE}`)).status).toBe(500);
      } finally {
        _setAuthzClientForTesting(base);
      }
      // both revokes were attempted (the second may have been applied), both roles re-granted
      const regranted = w.authz.grants.slice(grantsBefore).filter((g) => g.listId === listId).map((g) => g.role).sort();
      expect(regranted).toEqual(['list-editor', 'list-viewer']);
      expect(await live(listId)).toHaveLength(2);
    });
  });
});
