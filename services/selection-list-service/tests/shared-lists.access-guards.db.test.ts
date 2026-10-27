// shared-lists.access-guards.db.test.ts - two guards on the access routes.
//
// 1. Permit keys are validated BEFORE any Security API write. A LEGACY mirror row whose org_id is neither a bare UUID
//    nor an `org_...` TypeID must make PUT / DELETE fail (400) with NOTHING written to the authority or the mirror -
//    never after revoke/grant landed (which would leave the new role in the authority and the old one in the
//    mirror). Defence in depth: a PermitKeyError raised AFTER a write landed is still compensated.
// 2. GET /access is a READ: while the platform org is suspended (writes fail closed) a platform operator can still
//    read a common list's grants (flag ON and OFF); PUT and DELETE stay refused.
// Real Postgres, real handlers, real app.

import type { Knex } from 'knex';
import { dbDescribe } from './helpers/testDb';
import { toUuid } from '@izzywdev/fuzefront-identity';
import { createWorld, ORG_A, P, PLATFORM, World } from './helpers/sharedWorld';
import { allFlagsExceptShared, flagClientWith } from './helpers/flagClient';
import { freshCommonList } from './helpers/suspensionFixtures';
import { PermitKeyError } from '../src/lib/permitKeys';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

dbDescribe('access route guards (real Postgres)', () => {
  let w: World;
  let n = 0;

  beforeAll(async () => {
    w = await createWorld(state);
    w.authz.member(ORG_A, P.aMember.userId);
    w.authz.member(PLATFORM, P.opEditor.userId);
  });
  afterAll(() => w.teardown());
  afterEach(async () => {
    await useFlags(true);
    await w.db('selection_list_ref_index').where({ entity_type: 'organization' }).update({ suspended_at: null, suspended_event_at: null, snapshot_at: null });
  });

  const useFlags = async (shared: boolean) => {
    const { setFlagClient } = await import('../src/flags');
    setFlagClient(shared ? flagClientWith(true) : { getBooleanValue: allFlagsExceptShared });
  };

  /** An ORG_A list owned by aAdmin, and a mirror row for aMember with the given (possibly malformed) org_id. */
  const listWithLegacyGrant = async (role: string, orgIdOnRow: string) => {
    const made = await w.api(P.aAdmin).post('/v1/selection-lists', { key: `legacy-${++n}`, name: 'Legacy' });
    expect(made.status).toBe(201);
    await w.db('selection_lists').where({ id: made.body.id }).update({ created_by: 'system' }); // out of the per-user quota
    const listId: string = made.body.id;
    await w.db('selection_list_access').insert({
      list_id: listId,
      user_id: toUuid(P.aMember.userId as never),
      role,
      granted_by: P.aAdmin.userId,
      org_id: orgIdOnRow,
    });
    return listId;
  };
  const mirror = (listId: string) => w.db('selection_list_access').where({ list_id: listId, user_id: toUuid(P.aMember.userId as never) }).first();
  const outboxCount = async () => Number(((await w.db('event_outbox').count('seq as c').first()) as { c: string }).c);

  describe('Permit keys are validated before any Security API write', () => {
    it.each([
      ['PUT a role change', 'list-viewer', (l: string) => w.api(P.aAdmin).put(`/v1/selection-lists/${l}/access/${P.aMember.userId}`, { role: 'list-editor' })],
      ['DELETE', 'list-viewer', (l: string) => w.api(P.aAdmin).del(`/v1/selection-lists/${l}/access/${P.aMember.userId}`)],
      ['PUT demoting an OWNER (the last-owner guard would call the authority)', 'list-owner', (l: string) => w.api(P.aAdmin).put(`/v1/selection-lists/${l}/access/${P.aMember.userId}`, { role: 'list-viewer' })],
      ['DELETE of an OWNER', 'list-owner', (l: string) => w.api(P.aAdmin).del(`/v1/selection-lists/${l}/access/${P.aMember.userId}`)],
    ] as Array<[string, string, (l: string) => PromiseLike<{ status: number; body: any }>]>)('%s: a malformed legacy org_id -> 400, NO authority write, mirror untouched, no event', async (_name, role, run) => {
      const listId = await listWithLegacyGrant(role, 'legacy-tenant-name');
      const before = await mirror(listId);
      const events = await outboxCount();
      const grants = w.authz.grants.length;
      const revokes = w.authz.revokes.length;
      const res = await run(listId);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(w.authz.grants).toHaveLength(grants); // not a single Security API write
      expect(w.authz.revokes).toHaveLength(revokes);
      expect(await mirror(listId)).toEqual(before);
      expect(await outboxCount()).toBe(events);
    });

    it('control: the same change on a well-formed row succeeds (the 400s above are the key check)', async () => {
      const listId = await listWithLegacyGrant('list-viewer', toUuid(ORG_A as never));
      const res = await w.api(P.aAdmin).put(`/v1/selection-lists/${listId}/access/${P.aMember.userId}`, { role: 'list-editor' });
      expect(res.status).toBe(200);
      expect((await mirror(listId)).role).toBe('list-editor');
    });

    it('defence in depth: a PermitKeyError raised AFTER the revoke landed is COMPENSATED (the prior role is restored), then answered 400', async () => {
      const { _setAuthzClientForTesting } = await import('../src/middleware/authz');
      const listId = await listWithLegacyGrant('list-viewer', toUuid(ORG_A as never));
      const subject = toUuid(P.aMember.userId as never);
      w.authz.give(toUuid(ORG_A as never), subject, listId, 'list-viewer'); // the authority holds the prior role
      const base = w.authz.asAuthzClient();
      let grantCalls = 0;
      _setAuthzClientForTesting({
        ...base,
        // the first grant is refused with a key error AFTER the revoke has landed (what an unvalidated key does in the wrapper)
        grant: async (...a: Parameters<typeof base.grant>) => {
          if (++grantCalls === 1) throw new PermitKeyError('tenant');
          return base.grant(...a);
        },
      } as never);
      try {
        const res = await w.api(P.aAdmin).put(`/v1/selection-lists/${listId}/access/${P.aMember.userId}`, { role: 'list-editor' });
        expect(res.status).toBe(400);
        expect(w.authz.roleOf(toUuid(ORG_A as never), subject, listId)).toBe('list-viewer'); // authority back to the mirror's role
        expect((await mirror(listId)).role).toBe('list-viewer');
      } finally {
        _setAuthzClientForTesting(base);
      }
    });
  });

  describe('GET /access is a read: suspension fails WRITES closed, not reads', () => {
    it.each([
      ['flag ON', true],
      ['shared-lists flag OFF', false],
    ] as Array<[string, boolean]>)('%s: suspended platform org -> the operator reads the grants (200); PUT and DELETE are refused (403 platform_suspended)', async (_name, shared) => {
      await useFlags(true);
      const c = await freshCommonList(w, `access-read-${++n}`);
      // a live grant to read (and to try to change)
      expect((await w.api(P.op).put(`${c.L}/access/${P.opEditor.userId}`, { role: 'list-editor' })).status).toBe(200);
      const { handleOrgDeleted } = await import('../src/events/org-deleted.handler');
      await handleOrgDeleted({
        version: '1.0',
        topic: 'identity.org.deleted',
        correlationId: `corr-access-${n}`,
        occurredAt: new Date(Date.now() - 5000).toISOString(),
        payload: { organizationId: toUuid(PLATFORM as never), slug: 'x', ownerId: null, cascade: 'soft' },
      } as never);
      expect((await w.db('selection_list_ref_index').where({ wire_id: PLATFORM }).first()).suspended_at).not.toBeNull();
      await useFlags(shared);

      const read = await w.api(P.op).get(`${c.L}/access`);
      expect(read.status).toBe(200);
      expect(read.body.items.map((g: any) => g.role).sort()).toEqual(['list-editor', 'list-owner']);
      // every other read keeps working too
      for (const url of [c.L, `${c.L}/items`, `${c.L}/translations`]) expect({ url, status: (await w.api(P.op).get(url)).status }).toEqual({ url, status: 200 });

      const put = await w.api(P.op).put(`${c.L}/access/${P.opEditor.userId}`, { role: 'list-viewer' });
      expect({ status: put.status, reason: put.body.reason }).toEqual({ status: 403, reason: 'platform_suspended' });
      const del = await w.api(P.op).del(`${c.L}/access/${P.opEditor.userId}`);
      expect({ status: del.status, reason: del.body.reason }).toEqual({ status: 403, reason: 'platform_suspended' });
      expect((await w.db('selection_list_access').where({ list_id: c.id, user_id: toUuid(P.opEditor.userId as never) }).first()).role).toBe('list-editor');
    });
  });
});
