// The "world" the shared-lists route suites run in: real Postgres (real migrations), the real Express app,
// a scriptable Security API (FakeAuthz), and a platform organization + customer organizations with principals
// holding the tenant roles of the contract's role table.
//
// Use from a test file as:
//
//   const state: { db: Knex | undefined } = { db: undefined };
//   jest.mock('../src/db', () => ({ get db() { return state.db; } }));   // must be in the test file (hoisting)
//   ... const w = await createWorld(state);
//
// Tenant roles (docs/planning/selection-lists-permit-actions.md):
//   admin  list create read_quota resolve read_shared publish_platform
//   editor list create          resolve read_shared            (a plain member)
//   viewer list                 resolve read_shared
//   developer: nothing

import type { Knex } from 'knex';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { createTestDb, TestDb } from './testDb';
import { FakeAuthz } from './fakeAuthz';
import { allFlagsOn } from './flagClient';

export const JWT_SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-shared-lists';
export const PLATFORM = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e00');
export const ORG_A = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e0a');
export const ORG_B = fromUuid('organization', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e0b');
const usr = (n: string) => fromUuid('user', `0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7e${n}`);

export interface Principal {
  userId: string;
  orgId: string;
}

export const ADMIN_ACTIONS = ['list', 'create', 'read_quota', 'resolve', 'read_shared', 'publish_platform'];
export const EDITOR_ACTIONS = ['list', 'create', 'resolve', 'read_shared'];
export const VIEWER_ACTIONS = ['list', 'resolve', 'read_shared'];

export const P = {
  /** platform operator: admin of the platform org */
  op: { userId: usr('01'), orgId: PLATFORM } as Principal,
  /** platform-org member without publish_platform (editor) */
  opEditor: { userId: usr('02'), orgId: PLATFORM } as Principal,
  /** customer org A */
  aAdmin: { userId: usr('11'), orgId: ORG_A } as Principal,
  aMember: { userId: usr('12'), orgId: ORG_A } as Principal,
  aMember2: { userId: usr('13'), orgId: ORG_A } as Principal,
  aViewer: { userId: usr('14'), orgId: ORG_A } as Principal,
  aDeveloper: { userId: usr('15'), orgId: ORG_A } as Principal,
  /** customer org B */
  bMember: { userId: usr('21'), orgId: ORG_B } as Principal,
};

export interface World {
  t: TestDb;
  db: Knex;
  app: any;
  authz: FakeAuthz;
  api: (p: Principal) => ReturnType<typeof makeApi>;
  /** Outbox rows added since the last call, oldest first. */
  newEvents: () => Promise<Array<{ topic: string; p: Record<string, any> }>>;
  teardown: () => Promise<void>;
}

function makeApi(app: any, p: Principal) {
  const h = { Authorization: `Bearer ${jwt.sign({ userId: p.userId, orgId: p.orgId }, JWT_SECRET)}` };
  return {
    get: (url: string) => request(app).get(url).set(h),
    post: (url: string, body?: object) => request(app).post(url).set(h).send(body ?? {}),
    patch: (url: string, body: object) => request(app).patch(url).set(h).send(body),
    put: (url: string, body: object) => request(app).put(url).set(h).send(body),
    del: (url: string) => request(app).delete(url).set(h),
  };
}

export async function createWorld(state: { db: Knex | undefined }): Promise<World> {
  // Imported lazily so the caller's jest.mock('../src/db') is in place first.
  const { createApp } = await import('../../src/app');
  const { setFlagClient } = await import('../../src/flags');
  const { _setAuthzClientForTesting, makeNoOpProxy } = await import('../../src/middleware/authz');
  const { _setGrantTokenProviderForTesting } = await import('../../src/lib/machineIdentity');
  const { _resetPlatformOrgCacheForTesting } = await import('../../src/lib/sharedLists');

  const t = await createTestDb();
  state.db = t.db;
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED = 'true'; // non-production: real decisions
  process.env.SELECTION_LIST_PLATFORM_ORG_ID = PLATFORM;
  _resetPlatformOrgCacheForTesting();
  setFlagClient({ getBooleanValue: allFlagsOn });
  const authz = new FakeAuthz();
  _setAuthzClientForTesting(authz.asAuthzClient());
  _setGrantTokenProviderForTesting({ getToken: async () => 'machine-token' });

  for (const [org, ps] of [
    [PLATFORM, [P.op]],
    [ORG_A, [P.aAdmin]],
    [ORG_B, []],
  ] as Array<[string, Principal[]]>) {
    for (const p of ps) authz.allowCatalog(org, p.userId, ADMIN_ACTIONS);
  }
  authz.allowCatalog(PLATFORM, P.opEditor.userId, EDITOR_ACTIONS);
  authz.allowCatalog(ORG_A, P.aMember.userId, EDITOR_ACTIONS);
  authz.allowCatalog(ORG_A, P.aMember2.userId, EDITOR_ACTIONS);
  authz.allowCatalog(ORG_A, P.aViewer.userId, VIEWER_ACTIONS);
  authz.allowCatalog(ORG_A, P.aDeveloper.userId, []);
  authz.allowCatalog(ORG_B, P.bMember.userId, EDITOR_ACTIONS);

  const app = createApp();
  let seen = 0n;
  return {
    t,
    db: t.db,
    app,
    authz,
    api: (p) => makeApi(app, p),
    newEvents: async () => {
      const rows = await t.db('event_outbox').where('seq', '>', seen.toString()).orderBy('seq');
      if (rows.length) seen = BigInt(rows[rows.length - 1].seq);
      return rows.map((r: any) => ({ topic: r.topic, p: r.payload }));
    },
    teardown: async () => {
      setFlagClient(null);
      _setAuthzClientForTesting(makeNoOpProxy());
      _setGrantTokenProviderForTesting(null);
      delete process.env.JWT_SECRET;
      delete process.env.FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED;
      delete process.env.SELECTION_LIST_PLATFORM_ORG_ID;
      _resetPlatformOrgCacheForTesting();
      await t.drop();
    },
  };
}

/**
 * A common list published by the platform operator through the API: key `priority`, items LOW and MID
 * (active) and OLD (archived), a French translation of the list and of LOW. Returns the ids.
 */
export async function publishPriorityList(w: World): Promise<{ listId: string; low: string; mid: string; old: string }> {
  const op = w.api(P.op);
  const created = await op.post('/v1/selection-lists', { key: 'priority', name: 'Priority', description: 'How urgent', visibility: 'platform' });
  if (created.status !== 201) throw new Error(`publish failed: ${created.status} ${JSON.stringify(created.body)}`);
  const listId: string = created.body.id;
  const mk = async (code: string, label: string) => (await op.post(`/v1/selection-lists/${listId}/items`, { code, label })).body.id as string;
  const low = await mk('LOW', 'Low');
  const mid = await mk('MID', 'Medium');
  const old = await mk('OLD', 'Obsolete');
  await op.post(`/v1/selection-lists/${listId}/items/${old}/archive`);
  await op.put(`/v1/selection-lists/${listId}/translations/fr`, { name: 'Priorité' });
  await op.put(`/v1/selection-lists/${listId}/items/${low}/translations/fr`, { label: 'Basse' });
  return { listId, low, mid, old };
}
