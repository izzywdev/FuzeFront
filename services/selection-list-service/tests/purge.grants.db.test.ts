// purge.grants.db.test.ts - review L-5: purging a list must also revoke the list
// instance's Security API grants (orphan `SelectionList:<id>` role assignments were
// left behind). Through the real Express app and REAL Postgres; the Security API
// client and the workload-token provider are the only doubles.
//
// The revocation runs AFTER the purge commits and is NON-FATAL: the list is gone
// either way, so a Security API hiccup is logged + counted, never a failed purge.
//
// Credential: the purging human's OWN token (the Security API re-checks their
// manage_access on the instance). Only a grant that token is refused (a grantee who
// has left the tenant) is retried with the workload token, which the Security API
// honours for a gone principal alone.

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
import { grantCleanupFailedTotal } from '../src/lib/metrics';
import { permitKey } from './helpers/ids';

const JWT_SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-purge-grants';
const ORG = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e91');
const USER = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7e91');
const USER2 = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7e92');
const USER3 = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7e93');
const WORKLOAD = 'workload-token-grant-cleanup';

const humanToken = () => jwt.sign({ userId: USER, orgId: ORG }, JWT_SECRET);
const auth = () => ({ Authorization: `Bearer ${humanToken()}` });
const cleanupFailures = async () =>
  (await grantCleanupFailedTotal.get()).values.filter((v) => v.labels['cause'] === 'purge').reduce((n, v) => n + v.value, 0);

dbDescribe('purge revokes the instance grants (real Postgres)', () => {
  let t: TestDb;
  let db: Knex;
  let app: ReturnType<typeof createApp>;
  let seq = 0;

  const revoke = jest.fn();
  const useAuthz = () =>
    _setAuthzClientForTesting({ ...makeNoOpProxy(), revoke } as any);

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    state.db = db;
    process.env.JWT_SECRET = JWT_SECRET;
    delete process.env.FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED;
    setFlagClient({ getBooleanValue: async () => true });
    app = createApp();
  });
  afterAll(async () => {
    setFlagClient(null);
    _setAuthzClientForTesting(makeNoOpProxy());
    _setGrantTokenProviderForTesting(null);
    delete process.env.JWT_SECRET;
    await t.drop();
  });
  const workloadToken = jest.fn();
  beforeEach(() => {
    revoke.mockReset().mockResolvedValue(undefined);
    useAuthz();
    workloadToken.mockReset().mockResolvedValue(WORKLOAD);
    _setGrantTokenProviderForTesting({ getToken: workloadToken });
  });

  /** A list owned by USER with USER2 (viewer) and USER3 (editor) granted through the real access route. */
  async function listWithGrants(): Promise<string> {
    const created = await request(app).post('/v1/selection-lists').set(auth()).send({ key: `purge-${++seq}`, name: `P${seq}` });
    expect(created.status).toBe(201);
    const id: string = created.body.id;
    for (const [user, role] of [[USER2, 'list-viewer'], [USER3, 'list-editor']] as const) {
      expect((await request(app).put(`/v1/selection-lists/${id}/access/${user}`).set(auth()).send({ role })).status).toBe(200);
    }
    revoke.mockClear(); // only the purge's calls from here on
    workloadToken.mockClear(); // (list creation bootstraps the owner with it)
    return id;
  }
  const res = (listId: string) => ({ type: 'SelectionList', key: listId });
  const purge = (id: string) => request(app).delete(`/v1/selection-lists/${id}?purge=true`).set(auth());

  it('revokes every live grant on the instance (all roles), scoped to the list, with the ACTING HUMAN\'s token, after the purge', async () => {
    const id = await listWithGrants();
    const r = await purge(id);

    expect(r.status).toBe(204);
    expect(await db('selection_lists').where({ id }).first()).toBeUndefined();
    expect(await db('selection_list_access').where({ list_id: id })).toEqual([]);
    expect(revoke).toHaveBeenCalledTimes(3);
    // jwt.sign embeds iat, so compare the token's claims rather than the compact string
    for (const call of revoke.mock.calls) {
      expect(jwt.decode(call[1] as string)).toMatchObject({ userId: USER, orgId: ORG });
      expect(call[1]).not.toBe(WORKLOAD);
    }
    const roles = revoke.mock.calls.map((c) => `${c[0].subject}:${c[0].role}`);
    expect(roles.sort()).toEqual([`${permitKey(USER)}:list-owner`, `${permitKey(USER2)}:list-viewer`, `${permitKey(USER3)}:list-editor`].sort());
    for (const call of revoke.mock.calls) expect(call[0]).toMatchObject({ tenant: permitKey(ORG), resource: res(id) });
    expect(workloadToken).not.toHaveBeenCalled(); // never needed when the human may revoke everything
  });

  it('revokes the ACTOR\'s own grant LAST: it is what authorizes the other revocations', async () => {
    const id = await listWithGrants();

    expect((await purge(id)).status).toBe(204);

    const subjects = revoke.mock.calls.map((c) => c[0].subject);
    expect(subjects).toHaveLength(3);
    expect(subjects[2]).toBe(permitKey(USER));
  });

  it('does not re-revoke a grant that was already revoked (its mirror row is soft-deleted)', async () => {
    const id = await listWithGrants();
    expect((await request(app).delete(`/v1/selection-lists/${id}/access/${USER2}`).set(auth())).status).toBe(204);
    revoke.mockClear();

    expect((await purge(id)).status).toBe(204);

    const subjects = revoke.mock.calls.map((c) => c[0].subject).sort();
    expect(subjects).toEqual([permitKey(USER), permitKey(USER3)].sort());
  });

  it('is NON-FATAL: a revoke refused for BOTH credentials is counted and logged, the purge still answers 204, and the other grants are still revoked', async () => {
    const id = await listWithGrants();
    revoke.mockImplementation(async (r: any) => {
      if (r.subject === permitKey(USER2)) throw new Error('security api 502');
    });
    const before = await cleanupFailures();

    const r = await purge(id);

    expect(r.status).toBe(204);
    expect(await db('selection_lists').where({ id }).first()).toBeUndefined();
    expect(revoke).toHaveBeenCalledTimes(4); // 3 grants + the one fallback retry; the failure did not stop the rest
    expect(await cleanupFailures()).toBe(before + 1);
  });

  it('a grant the human token is refused (grantee left the tenant) is retried ONCE with the workload token, and only that grant', async () => {
    const id = await listWithGrants();
    revoke.mockImplementation(async (r: any, token: string) => {
      if (r.subject === permitKey(USER2) && token !== WORKLOAD) throw new Error('403 forbidden: no active membership');
    });
    const before = await cleanupFailures();

    expect((await purge(id)).status).toBe(204);

    const viaWorkload = revoke.mock.calls.filter((c) => c[1] === WORKLOAD);
    expect(viaWorkload).toHaveLength(1);
    expect(viaWorkload[0][0]).toEqual({ subject: permitKey(USER2), tenant: permitKey(ORG), role: 'list-viewer', resource: res(id) });
    expect(workloadToken).toHaveBeenCalledTimes(1);
    expect(await cleanupFailures()).toBe(before); // fully cleaned up: nothing left for reconciliation
  });

  it('is NON-FATAL without a workload identity: the human-revocable grants are still revoked, the refused one is counted', async () => {
    const id = await listWithGrants();
    workloadToken.mockRejectedValue(new Error('no workload identity'));
    revoke.mockImplementation(async (r: any) => {
      if (r.subject === permitKey(USER2)) throw new Error('403 forbidden: no active membership');
    });
    const before = await cleanupFailures();

    const r = await purge(id);

    expect(r.status).toBe(204);
    expect(revoke).toHaveBeenCalledTimes(3);
    expect(await cleanupFailures()).toBe(before + 1);
  });

  it('archiving (the default DELETE, and POST /archive) revokes nothing: the grants still mean something on an archived list', async () => {
    const id = await listWithGrants();
    expect((await request(app).delete(`/v1/selection-lists/${id}`).set(auth())).status).toBe(200);
    expect((await request(app).post(`/v1/selection-lists/${id}/archive`).set(auth())).status).toBe(200);
    expect(revoke).not.toHaveBeenCalled();
    expect(await db('selection_list_access').where({ list_id: id }).whereNull('revoked_at')).toHaveLength(3);
  });

  it('a purge of a list that does not exist is 404 and touches nothing', async () => {
    const r = await purge('front_sl_00000000000000000000000000');
    expect([404]).toContain(r.status);
    expect(revoke).not.toHaveBeenCalled();
  });
});
