// purge.grants.db.test.ts - review L-5: purging a list must also revoke the list
// instance's Security API grants (orphan `SelectionList:<id>` role assignments were
// left behind). Through the real Express app and REAL Postgres; the Security API
// client and the machine-token provider are the only doubles.
//
// The revocation runs AFTER the purge commits and is NON-FATAL: the list is gone
// either way, so a Security API hiccup is logged + counted, never a failed purge.

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

const JWT_SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-purge-grants';
const ORG = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e91');
const USER = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7e91');
const USER2 = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7e92');
const USER3 = fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7e93');
const MACHINE = 'machine-token-authz-admin';

const auth = () => ({ Authorization: `Bearer ${jwt.sign({ userId: USER, orgId: ORG }, JWT_SECRET)}` });
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
  beforeEach(() => {
    revoke.mockReset().mockResolvedValue(undefined);
    useAuthz();
    _setGrantTokenProviderForTesting({ getToken: async () => MACHINE });
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
    return id;
  }
  const res = (listId: string) => ({ type: 'SelectionList', key: listId });
  const purge = (id: string) => request(app).delete(`/v1/selection-lists/${id}?purge=true`).set(auth());

  it('revokes every live grant on the instance (all roles), scoped to the list, with the machine token, after the purge', async () => {
    const id = await listWithGrants();

    const r = await purge(id);

    expect(r.status).toBe(204);
    expect(await db('selection_lists').where({ id }).first()).toBeUndefined();
    expect(await db('selection_list_access').where({ list_id: id })).toEqual([]);
    expect(revoke).toHaveBeenCalledTimes(3);
    expect(revoke).toHaveBeenCalledWith({ subject: USER, tenant: ORG, role: 'list-owner', resource: res(id) }, MACHINE);
    expect(revoke).toHaveBeenCalledWith({ subject: USER2, tenant: ORG, role: 'list-viewer', resource: res(id) }, MACHINE);
    expect(revoke).toHaveBeenCalledWith({ subject: USER3, tenant: ORG, role: 'list-editor', resource: res(id) }, MACHINE);
  });

  it('does not re-revoke a grant that was already revoked (its mirror row is soft-deleted)', async () => {
    const id = await listWithGrants();
    expect((await request(app).delete(`/v1/selection-lists/${id}/access/${USER2}`).set(auth())).status).toBe(204);
    revoke.mockClear();

    expect((await purge(id)).status).toBe(204);

    const subjects = revoke.mock.calls.map((c) => c[0].subject).sort();
    expect(subjects).toEqual([USER, USER3].sort());
  });

  it('is NON-FATAL: a failing revoke is counted and logged, the purge still answers 204, and the other grants are still revoked', async () => {
    const id = await listWithGrants();
    revoke.mockImplementation(async (r: any) => {
      if (r.subject === USER2) throw new Error('security api 502');
    });
    const before = await cleanupFailures();

    const r = await purge(id);

    expect(r.status).toBe(204);
    expect(await db('selection_lists').where({ id }).first()).toBeUndefined();
    expect(revoke).toHaveBeenCalledTimes(3); // the failure did not stop the remaining grants
    expect(await cleanupFailures()).toBe(before + 1);
  });

  it('is NON-FATAL without a machine identity too (counted for every grant it could not revoke)', async () => {
    const id = await listWithGrants();
    _setGrantTokenProviderForTesting({ getToken: async () => { throw new Error('no machine identity'); } });
    const before = await cleanupFailures();

    const r = await purge(id);

    expect(r.status).toBe(204);
    expect(revoke).not.toHaveBeenCalled();
    expect(await cleanupFailures()).toBe(before + 3);
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
