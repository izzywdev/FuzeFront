// user-deleted.grants.db.test.ts - identity.user.deleted must also take the deleted
// user's LIST GRANTS away (review M-2): revoke each in the Security API (the
// authority, with the service's machine identity), delete the mirror rows, announce
// access.revoked through the outbox, and flag a list that is left without an owner.
// Real Postgres (real migrations, real outbox); the Security API client and the
// machine-token provider are the only doubles.

import type { Knex } from 'knex';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { TOPICS } from '@fuzefront/shared/kafka';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';

const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

import { handleUserDeleted } from '../src/events/user-deleted.handler';
import { RetryBudget } from '../src/events/retryBudget';
import { _setAuthzClientForTesting, makeNoOpProxy } from '../src/middleware/authz';
import { _setGrantTokenProviderForTesting } from '../src/lib/machineIdentity';
import { ownerlessListsTotal, grantCleanupFailedTotal } from '../src/lib/metrics';

const ORG_A = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7a01');
const ORG_B = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7a02');
const GONE_UUID = '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7a01';
const GONE = fromUuid('user', GONE_UUID);
const PEER = fromUuid('user', '0195a8f2-bbbb-7a11-8b2d-3f4e5a6b7a02');
const MACHINE = 'machine-token-authz-admin';

const event = (userId = GONE_UUID) =>
  ({ correlationId: 'corr-ud', payload: { userId, email: 'gone@example.com', cascade: 'soft' } }) as any;

async function metric(m: { get: () => Promise<{ values: Array<{ value: number; labels: Record<string, unknown> }> }> }, labels: Record<string, string> = {}): Promise<number> {
  const { values } = await m.get();
  return values.filter((v) => Object.entries(labels).every(([k, x]) => v.labels[k] === x)).reduce((n, v) => n + v.value, 0);
}

dbDescribe('identity.user.deleted -> list grants (real Postgres)', () => {
  let t: TestDb;
  let db: Knex;
  let n = 0;

  const revoke = jest.fn();
  const bulkCheck = jest.fn();
  const authz = () =>
    ({
      check: jest.fn().mockResolvedValue({ allow: true }),
      bulkCheck,
      grant: jest.fn(),
      revoke,
      listGrants: jest.fn(),
      setAttributes: jest.fn(),
    }) as any;

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    state.db = db;
  });
  afterAll(async () => {
    _setAuthzClientForTesting(makeNoOpProxy());
    _setGrantTokenProviderForTesting(null);
    await t.drop();
  });
  beforeEach(async () => {
    // every test starts from an empty service (the mirror has an FK to the list, so children first)
    await db('selection_list_access').del();
    await db('selection_list_translations').del();
    await db('selection_lists').del();
    await db('event_outbox').del();
    revoke.mockReset().mockResolvedValue(undefined);
    // default authority: every candidate owner is confirmed
    bulkCheck.mockReset().mockImplementation(async (checks: unknown[]) => checks.map(() => ({ allow: true })));
    _setAuthzClientForTesting(authz());
    _setGrantTokenProviderForTesting({ getToken: async () => MACHINE });
  });

  /** A list in `org` with the given mirror grants: [userId, role, revoked?]. */
  async function list(org: string, grants: Array<[string, string, boolean?]>): Promise<string> {
    n += 1;
    const id = `front_sl_udg${String(n).padStart(4, '0')}`;
    await db('selection_lists').insert({ id, organization_id: org, key: `udg-${n}`, created_by: PEER });
    await db('selection_list_translations').insert({ list_id: id, locale: 'en', name: `List ${n}` });
    for (const [user_id, role, revoked] of grants) {
      await db('selection_list_access').insert({
        list_id: id,
        user_id,
        role,
        granted_by: PEER,
        org_id: org,
        revoked_at: revoked ? db.fn.now() : null,
      });
    }
    return id;
  }
  const mirror = (listId: string) =>
    db('selection_list_access').where({ list_id: listId }).orderBy('user_id').select('user_id', 'role', 'revoked_at');
  const outbox = async (topic: string) => db('event_outbox').where({ topic }).orderBy('seq');
  const res = (listId: string) => ({ type: 'SelectionList', key: listId });

  it('revokes every grant the user holds, in every org, with the machine token and the instance scope; removes the mirror rows; leaves other users alone', async () => {
    const a = await list(ORG_A, [[GONE, 'list-viewer'], [PEER, 'list-owner']]);
    const b = await list(ORG_B, [[GONE, 'list-editor'], [PEER, 'list-owner']]);
    const before = (await outbox(TOPICS.SELECTION_LISTS_ACCESS_REVOKED)).length;
    expect(before).toBe(0);

    await handleUserDeleted(event());

    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith({ subject: GONE, tenant: ORG_A, role: 'list-viewer', resource: res(a) }, MACHINE);
    expect(revoke).toHaveBeenCalledWith({ subject: GONE, tenant: ORG_B, role: 'list-editor', resource: res(b) }, MACHINE);
    expect(await mirror(a)).toEqual([expect.objectContaining({ user_id: PEER, role: 'list-owner' })]);
    expect(await mirror(b)).toEqual([expect.objectContaining({ user_id: PEER, role: 'list-owner' })]);

    // access.revoked is announced through the outbox, once per removed live grant, by the system principal
    const evs = (await outbox(TOPICS.SELECTION_LISTS_ACCESS_REVOKED)).slice(before);
    expect(evs).toHaveLength(2);
    expect(evs.map((e) => e.payload.userId)).toEqual([GONE, GONE]);
    expect(evs.every((e) => e.payload.actor.type === 'system')).toBe(true);
    expect(evs.map((e) => e.organization_id).sort()).toEqual([ORG_A, ORG_B].sort());
  });

  it('is idempotent: a replay finds nothing to revoke and announces nothing more', async () => {
    const a = await list(ORG_A, [[GONE, 'list-viewer'], [PEER, 'list-owner']]);
    await handleUserDeleted(event());
    const events = (await outbox(TOPICS.SELECTION_LISTS_ACCESS_REVOKED)).length;
    revoke.mockClear();

    await expect(handleUserDeleted(event())).resolves.toBeUndefined();

    expect(revoke).not.toHaveBeenCalled();
    expect((await outbox(TOPICS.SELECTION_LISTS_ACCESS_REVOKED)).length).toBe(events);
    expect(await mirror(a)).toHaveLength(1);
  });

  it('matches a mirror row stored under EITHER rendering of the user id and revokes under the STORED subject', async () => {
    const a = await list(ORG_A, [[GONE_UUID, 'list-viewer'], [PEER, 'list-owner']]); // the bare-UUID rendering
    await handleUserDeleted(event(GONE_UUID));
    expect(revoke).toHaveBeenCalledWith({ subject: GONE_UUID, tenant: ORG_A, role: 'list-viewer', resource: res(a) }, MACHINE);
    expect(await mirror(a)).toHaveLength(1);

    const b = await list(ORG_A, [[GONE, 'list-viewer'], [PEER, 'list-owner']]); // the TypeID rendering
    await handleUserDeleted(event(GONE_UUID));
    expect(revoke).toHaveBeenCalledWith({ subject: GONE, tenant: ORG_A, role: 'list-viewer', resource: res(b) }, MACHINE);
  });

  it('a previously revoked mirror row is simply removed: no Security API call, no event', async () => {
    const a = await list(ORG_A, [[GONE, 'list-viewer', true], [PEER, 'list-owner']]);
    const before = (await outbox(TOPICS.SELECTION_LISTS_ACCESS_REVOKED)).length;

    await handleUserDeleted(event());

    expect(revoke).not.toHaveBeenCalled();
    expect((await outbox(TOPICS.SELECTION_LISTS_ACCESS_REVOKED)).length).toBe(before);
    expect(await mirror(a)).toHaveLength(1);
  });

  it('a user with no list grants needs no machine identity at all', async () => {
    _setGrantTokenProviderForTesting({ getToken: async () => { throw new Error('no machine identity'); } });
    await list(ORG_A, [[PEER, 'list-owner']]);
    await expect(handleUserDeleted(event())).resolves.toBeUndefined();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('with grants but no machine identity it THROWS (retried), leaves the mirror intact and revokes nothing', async () => {
    const a = await list(ORG_A, [[GONE, 'list-viewer'], [PEER, 'list-owner']]);
    _setGrantTokenProviderForTesting({ getToken: async () => { throw new Error('no machine identity'); } });

    await expect(handleUserDeleted(event())).rejects.toThrow('no machine identity');

    expect(revoke).not.toHaveBeenCalled();
    expect(await mirror(a)).toHaveLength(2);
  });

  describe('the last-owner fallback', () => {
    it('another owner CONFIRMED by the authority: removed quietly, list is not flagged', async () => {
      const a = await list(ORG_A, [[GONE, 'list-owner'], [PEER, 'list-owner']]);
      const flagged = await metric(ownerlessListsTotal);

      await handleUserDeleted(event());

      expect(revoke).toHaveBeenCalledTimes(1);
      expect(bulkCheck).toHaveBeenCalledWith(
        [{ subject: PEER, tenant: ORG_A, resource: res(a), action: 'manage_access' }],
        MACHINE,
      );
      expect(await mirror(a)).toEqual([expect.objectContaining({ user_id: PEER })]);
      expect(await metric(ownerlessListsTotal)).toBe(flagged);
    });

    it('the deleted user was the SOLE owner: the grant is still revoked, but the list is FLAGGED (metric), not silently orphaned', async () => {
      const a = await list(ORG_A, [[GONE, 'list-owner'], [PEER, 'list-viewer']]);
      const flagged = await metric(ownerlessListsTotal, { cause: 'user_deleted' });

      await handleUserDeleted(event());

      expect(revoke).toHaveBeenCalledWith({ subject: GONE, tenant: ORG_A, role: 'list-owner', resource: res(a) }, MACHINE);
      expect((await mirror(a)).map((r: any) => r.user_id)).toEqual([PEER]);
      expect(await metric(ownerlessListsTotal, { cause: 'user_deleted' })).toBe(flagged + 1);
    });

    it('another mirror owner the authority does NOT confirm is not an owner: the list is flagged', async () => {
      const a = await list(ORG_A, [[GONE, 'list-owner'], [PEER, 'list-owner']]);
      bulkCheck.mockImplementation(async (checks: unknown[]) => checks.map(() => ({ allow: false })));
      const flagged = await metric(ownerlessListsTotal, { cause: 'user_deleted' });

      await handleUserDeleted(event());

      expect(await metric(ownerlessListsTotal, { cause: 'user_deleted' })).toBe(flagged + 1);
      expect(await mirror(a)).toHaveLength(1);
    });
  });

  describe('failures', () => {
    it('one list failing does not stop the others; the handler throws so the event is retried, and the retry finishes the job without repeating work', async () => {
      const a = await list(ORG_A, [[GONE, 'list-viewer'], [PEER, 'list-owner']]);
      const b = await list(ORG_B, [[GONE, 'list-editor'], [PEER, 'list-owner']]);
      revoke.mockImplementation(async (r: any) => {
        if (r.resource.key === a) throw new Error('security api 502');
      });
      const failed = await metric(grantCleanupFailedTotal, { cause: 'user_deleted' });

      await expect(handleUserDeleted(event(), { budget: new RetryBudget(5) })).rejects.toThrow('1 grant revocation(s) failed');

      expect(await mirror(a)).toHaveLength(2); // left intact for the retry
      expect(await mirror(b)).toHaveLength(1); // done
      expect(await metric(grantCleanupFailedTotal, { cause: 'user_deleted' })).toBe(failed + 1);

      revoke.mockReset().mockResolvedValue(undefined); // the Security API recovers
      await expect(handleUserDeleted(event(), { budget: new RetryBudget(5) })).resolves.toBeUndefined();

      expect(revoke).toHaveBeenCalledTimes(1); // only the list that was left
      expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ resource: res(a) }), MACHINE);
      expect(await mirror(a)).toHaveLength(1);
      // exactly one access.revoked per removed live grant overall (no duplicate from the retry)
      expect(await outbox(TOPICS.SELECTION_LISTS_ACCESS_REVOKED)).toHaveLength(2);
    });

    it('the attempt that spends the retry budget dead-letters the event and RETURNS (the partition is not wedged)', async () => {
      const a = await list(ORG_A, [[GONE, 'list-viewer'], [PEER, 'list-owner']]);
      revoke.mockRejectedValue(new Error('security api 502'));
      const deadLetter = jest.fn().mockResolvedValue(undefined);
      const budget = new RetryBudget(2);

      await expect(handleUserDeleted(event(), { budget, deadLetter })).rejects.toThrow(); // attempt 1: retried
      expect(deadLetter).not.toHaveBeenCalled();
      await expect(handleUserDeleted(event(), { budget, deadLetter })).resolves.toBeUndefined(); // attempt 2: last

      expect(deadLetter).toHaveBeenCalledTimes(1);
      expect(deadLetter).toHaveBeenCalledWith(TOPICS.IDENTITY_USER_DELETED, expect.objectContaining({ correlationId: 'corr-ud' }), expect.stringContaining('grant revocation'));
      expect(await mirror(a)).toHaveLength(2); // still there for a manual / later replay
    });

    it('without a dead-letter sink the budget never swallows the failure', async () => {
      await list(ORG_A, [[GONE, 'list-viewer'], [PEER, 'list-owner']]);
      revoke.mockRejectedValue(new Error('security api 502'));
      const budget = new RetryBudget(1);
      await expect(handleUserDeleted(event(), { budget })).rejects.toThrow();
      await expect(handleUserDeleted(event(), { budget })).rejects.toThrow();
    });

    it('a revoke that fails leaves the mirror row (authority first, mirror second): no mirror claim of a change that did not happen', async () => {
      const a = await list(ORG_A, [[GONE, 'list-viewer'], [PEER, 'list-owner']]);
      revoke.mockRejectedValue(new Error('security api 502'));
      await expect(handleUserDeleted(event(), { budget: new RetryBudget(9) })).rejects.toThrow();
      expect(await mirror(a)).toHaveLength(2);
    });
  });
});
