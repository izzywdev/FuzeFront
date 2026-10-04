// access.routes.test.ts — unit tests for the access-grant endpoints (S7, FFRNT-190).
//
// Covers:
//  A) GET    /:listId/access          — cursor-paginated roster (snake_case contract shape)
//  B) PUT    /:listId/access/:userId  — grant / change role (roles do not stack)
//  C) DELETE /:listId/access/:userId  — revoke access (idempotent)
//
// The DB is replaced by a small in-memory fake that implements exactly the
// Knex subset access.ts uses (where/whereNull/orderBy/limit/count/first/update,
// forUpdate, raw upsert, transaction with ROLLBACK semantics). That lets the
// tests assert on observable STATE — "the mirror row did not change when the
// Security API write threw" — rather than on which mock method was called.
// The Security API's AuthzClient (@fuzefront/auth, via middleware/authz.ts) is
// injected via _setAuthzClientForTesting(); the authz flag is an env var.

// ─── In-memory DB fake ────────────────────────────────────────────────────────
type Row = Record<string, any>;

const tables: Record<string, Row[]> = { selection_lists: [], selection_list_access: [] };
const callLog: string[] = [];

function snapshot(): Record<string, Row[]> {
  return JSON.parse(JSON.stringify(tables));
}
function restore(s: Record<string, Row[]>): void {
  for (const k of Object.keys(tables)) tables[k] = s[k] ?? [];
}

function builder(table: string): any {
  const filters: Array<(r: Row) => boolean> = [];
  let orderCol: string | undefined;
  let lim: number | undefined;
  let mode: 'rows' | 'first' | 'count' | 'update' = 'rows';
  let patch: Row | undefined;

  const exec = async (): Promise<any> => {
    let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (orderCol) rows = [...rows].sort((a, b) => String(a[orderCol!]).localeCompare(String(b[orderCol!])));
    if (lim !== undefined) rows = rows.slice(0, lim);
    if (mode === 'update') {
      rows.forEach((r) => Object.assign(r, patch));
      callLog.push(`update:${table}`);
      return rows.length;
    }
    if (mode === 'count') return { count: String(rows.length) };
    if (mode === 'first') return rows[0];
    return rows;
  };

  const b: any = {
    where(a: any, op?: any, v?: any) {
      if (typeof a === 'object') filters.push((r) => Object.entries(a).every(([k, x]) => r[k] === x));
      else if (op === '>') filters.push((r) => r[a] > v);
      else filters.push((r) => r[a] === op);
      return b;
    },
    whereNull(c: string) {
      filters.push((r) => r[c] == null);
      return b;
    },
    select() { return b; },
    forUpdate() { return b; },
    orderBy(c: string) { orderCol = c; return b; },
    count() { mode = 'count'; return b; },
    first() { if (mode !== 'count') mode = 'first'; return b; },
    limit(n: number) { lim = n; return b; },
    update(p: Row) { mode = 'update'; patch = p; return b; },
    then(res: any, rej: any) { return exec().then(res, rej); },
  };
  return b;
}

function makeDb(): any {
  const fn: any = (table: string) => builder(table);
  fn.fn = { now: () => new Date('2026-01-01T00:00:00.000Z') };
  // The only raw statement access.ts issues is the mirror upsert.
  fn.raw = async (_sql: string, params: any[]) => {
    const [list_id, user_id, role, granted_by, org_id] = params;
    const existing = tables.selection_list_access.find((r) => r.list_id === list_id && r.user_id === user_id);
    const now = new Date('2026-02-02T00:00:00.000Z');
    if (existing) {
      const wasRevoked = existing.revoked_at != null;
      Object.assign(existing, {
        role,
        granted_by,
        org_id,
        granted_at: wasRevoked ? now : existing.granted_at,
        updated_at: now,
        revoked_at: null,
      });
    } else {
      tables.selection_list_access.push({
        list_id, user_id, role, granted_by, org_id, granted_at: now, updated_at: now, revoked_at: null,
      });
    }
    callLog.push('mirror:upsert');
    return { rows: [] };
  };
  fn.transaction = async (cb: (t: any) => Promise<any>) => {
    const snap = snapshot();
    try {
      return await cb(fn);
    } catch (err) {
      restore(snap); // ROLLBACK
      throw err;
    }
  };
  return fn;
}

jest.mock('../src/db', () => ({
  get db() {
    return (global as any).__accessTestDb;
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { AuthzClient, AuthzError } from '@fuzefront/auth';
import accessRouter from '../src/routes/access';
import { _setAuthzClientForTesting, makeNoOpProxy } from '../src/middleware/authz';
import { _setGrantTokenProviderForTesting } from '../src/lib/machineIdentity';

// ─── Constants ────────────────────────────────────────────────────────────────
// Test-only signing secret (never a production credential); overridable via
// TEST_JWT_SECRET so the literal is an obviously fake fallback.
const JWT_SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-s7-access-routes';
process.env.JWT_SECRET = JWT_SECRET;

const LIST_ID = 'front_sl_testlist01'; // contract shape (^front_sl_[0-9a-z]+$) — edge validation 400s anything else
const USER_ID = 'usr_alice';
const ACTOR_ID = 'usr_admin';
const ORG_ID = 'org_corp';
const MACHINE_TOKEN = 'machine-token-authz-admin';
const machineGetToken = jest.fn();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign({ userId: ACTOR_ID, orgId: ORG_ID, ...overrides }, JWT_SECRET);
}
const auth = () => ({ Authorization: `Bearer ${makeToken()}` });

function makeApp(): express.Application {
  const app = express();
  app.use(express.json());
  // Mount under /lists so :listId and :userId params resolve correctly.
  app.use('/lists', accessRouter);
  return app;
}

/** Allow-all AuthzClient with jest.fn() spies; every call is also appended to callLog. */
function makeAuthzClient(overrides: Partial<AuthzClient> = {}): AuthzClient {
  return {
    check: jest.fn().mockResolvedValue({ allow: true }),
    bulkCheck: jest.fn().mockResolvedValue([]),
    grant: jest.fn(async () => {
      callLog.push('authz:grant');
      return { id: 'g1', subject: USER_ID, tenant: ORG_ID, role: 'list-viewer' };
    }),
    revoke: jest.fn(async () => {
      callLog.push('authz:revoke');
    }),
    listGrants: jest.fn().mockResolvedValue({ items: [], page: { nextCursor: null, hasMore: false } }),
    ...overrides,
  } as AuthzClient;
}

function seedAccess(user_id: string, role: string, extra: Row = {}): void {
  tables.selection_list_access.push({
    list_id: LIST_ID,
    user_id,
    role,
    granted_by: ACTOR_ID,
    org_id: ORG_ID,
    granted_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    revoked_at: null,
    ...extra,
  });
}

function accessRow(user_id: string): Row | undefined {
  return tables.selection_list_access.find((r) => r.list_id === LIST_ID && r.user_id === user_id);
}

beforeEach(() => {
  (global as any).__accessTestDb = makeDb();
  tables.selection_lists = [{ id: LIST_ID, organization_id: ORG_ID }];
  tables.selection_list_access = [];
  callLog.length = 0;
  _setAuthzClientForTesting(makeAuthzClient());
  // Grant/revoke writes use the service's MACHINE token (never the caller's).
  machineGetToken.mockReset().mockResolvedValue(MACHINE_TOKEN);
  _setGrantTokenProviderForTesting({ getToken: machineGetToken });
});

afterEach(() => {
  delete process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'];
  _setAuthzClientForTesting(makeNoOpProxy());
  _setGrantTokenProviderForTesting(null);
});

// ─── A) GET /:listId/access ───────────────────────────────────────────────────
describe('GET /:listId/access', () => {
  it('returns 401 with no token', async () => {
    const res = await request(makeApp()).get(`/lists/${LIST_ID}/access`);
    expect(res.status).toBe(401);
  });

  it('returns the pagination envelope with snake_case SelectionListAccessGrant items', async () => {
    seedAccess('usr_a', 'list-owner');
    seedAccess('usr_b', 'list-viewer');

    const res = await request(makeApp()).get(`/lists/${LIST_ID}/access`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.page).toEqual({ nextCursor: null, hasMore: false });
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toEqual({
      list_id: LIST_ID,
      user_id: 'usr_a',
      role: 'list-owner',
      granted_by: ACTOR_ID,
      granted_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    // No camelCase / org leakage from the mirror row.
    expect(Object.keys(res.body.items[0]).sort()).toEqual(
      ['granted_at', 'granted_by', 'list_id', 'role', 'updated_at', 'user_id'],
    );
  });

  it('omits revoked grants', async () => {
    seedAccess('usr_a', 'list-owner');
    seedAccess('usr_gone', 'list-viewer', { revoked_at: new Date() });

    const res = await request(makeApp()).get(`/lists/${LIST_ID}/access`).set(auth());

    expect(res.body.items.map((i: Row) => i.user_id)).toEqual(['usr_a']);
  });

  it('clamps limit to the 200 maximum server-side', async () => {
    for (let i = 0; i < 250; i++) seedAccess(`usr_${String(i).padStart(3, '0')}`, 'list-viewer');

    const res = await request(makeApp()).get(`/lists/${LIST_ID}/access?limit=9999`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(200);
    expect(res.body.page.hasMore).toBe(true);
    expect(res.body.page.nextCursor).not.toBeNull();
  });

  it('pages through every grant exactly once by echoing nextCursor (no gaps, no duplicates)', async () => {
    for (let i = 0; i < 7; i++) seedAccess(`usr_${i}`, 'list-viewer');

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/lists/${LIST_ID}/access?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await request(makeApp()).get(url).set(auth());
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((i: Row) => i.user_id));
      cursor = res.body.page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toEqual(['usr_0', 'usr_1', 'usr_2', 'usr_3', 'usr_4', 'usr_5', 'usr_6']);
  });

  it('returns 404 for a list that is not in the caller\'s organization', async () => {
    tables.selection_lists = [{ id: LIST_ID, organization_id: 'org_other' }];
    const res = await request(makeApp()).get(`/lists/${LIST_ID}/access`).set(auth());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('requires manage_access (flag ON): a denial is a 403', async () => {
    process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'] = 'true';
    const check = jest.fn().mockResolvedValue({ allow: false });
    _setAuthzClientForTesting(makeAuthzClient({ check }));

    const res = await request(makeApp()).get(`/lists/${LIST_ID}/access`).set(auth());

    expect(res.status).toBe(403);
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'manage_access', resource: { type: 'SelectionList', key: LIST_ID } }),
      expect.any(String),
    );
  });
});

// ─── B) PUT /:listId/access/:userId ──────────────────────────────────────────
describe('PUT /:listId/access/:userId', () => {
  const put = (body: unknown, userId = USER_ID) =>
    request(makeApp()).put(`/lists/${LIST_ID}/access/${userId}`).set(auth()).send(body as object);

  it('returns 401 with no token', async () => {
    const res = await request(makeApp()).put(`/lists/${LIST_ID}/access/${USER_ID}`).send({ role: 'list-viewer' });
    expect(res.status).toBe(401);
  });

  it('returns 400 VALIDATION_ERROR for an invalid role', async () => {
    const res = await put({ role: 'list-hacker' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(callLog).toEqual([]);
  });

  it('returns 400 VALIDATION_ERROR when role is missing', async () => {
    const res = await put({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown body properties (additionalProperties: false)', async () => {
    const res = await put({ role: 'list-viewer', user_id: 'usr_mallory' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a userId that is not a usr_-prefixed reference', async () => {
    const res = await put({ role: 'list-viewer' }, 'org_not_a_user');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when the list is not in the caller\'s organization', async () => {
    tables.selection_lists = [{ id: LIST_ID, organization_id: 'org_other' }];
    const res = await put({ role: 'list-viewer' });
    expect(res.status).toBe(404);
  });

  it('returns 400 VALIDATION_ERROR when the target user is not a member of the org', async () => {
    const check = jest.fn().mockResolvedValue({ allow: false });
    const grant = jest.fn();
    _setAuthzClientForTesting(makeAuthzClient({ check, grant }));

    const res = await put({ role: 'list-viewer' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    // Membership is asked about the TARGET user, in the list's org.
    expect(check).toHaveBeenCalledWith(
      { subject: USER_ID, tenant: ORG_ID, resource: { type: 'Organization' }, action: 'read' },
      expect.any(String),
    );
    expect(grant).not.toHaveBeenCalled();
    expect(accessRow(USER_ID)).toBeUndefined();
  });

  it('fails closed (500, no grant) when the membership check itself throws', async () => {
    const check = jest.fn().mockRejectedValue(new AuthzError('DECISION_UNAVAILABLE', 'timeout; denying.'));
    const grant = jest.fn();
    _setAuthzClientForTesting(makeAuthzClient({ check, grant }));

    const res = await put({ role: 'list-viewer' });

    expect(res.status).toBe(500);
    expect(grant).not.toHaveBeenCalled();
  });

  it('grants the role: scopes the grant to this list instance and returns the contract AccessGrant shape', async () => {
    const grant = jest.fn(async () => ({ id: 'g1', subject: USER_ID, tenant: ORG_ID, role: 'list-viewer' }));
    _setAuthzClientForTesting(makeAuthzClient({ grant }));

    const res = await put({ role: 'list-viewer' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      list_id: LIST_ID,
      user_id: USER_ID,
      role: 'list-viewer',
      granted_by: ACTOR_ID,
      granted_at: expect.any(String),
      updated_at: expect.any(String),
    });
    // resource MUST reach the wire — its absence would silently turn this
    // list-scoped grant into a tenant-wide one (real privilege escalation).
    expect(grant).toHaveBeenCalledWith(
      { subject: USER_ID, tenant: ORG_ID, role: 'list-viewer', resource: { type: 'SelectionList', key: LIST_ID } },
      MACHINE_TOKEN,
    );
    expect(accessRow(USER_ID)).toMatchObject({ role: 'list-viewer', org_id: ORG_ID });
  });

  it('writes the Security API BEFORE the mirror', async () => {
    await put({ role: 'list-viewer' });
    expect(callLog.indexOf('authz:grant')).toBeGreaterThanOrEqual(0);
    expect(callLog.indexOf('authz:grant')).toBeLessThan(callLog.indexOf('mirror:upsert'));
  });

  it('roles do not stack: changing a role revokes the old one first, keeps granted_at, one live row', async () => {
    seedAccess(USER_ID, 'list-viewer');
    const revoke = jest.fn(async () => { callLog.push('authz:revoke'); });
    _setAuthzClientForTesting(makeAuthzClient({ revoke }));

    const res = await put({ role: 'list-editor' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('list-editor');
    expect(res.body.granted_at).toBe('2026-01-01T00:00:00.000Z'); // first-created time is preserved
    expect(revoke).toHaveBeenCalledWith(
      { subject: USER_ID, tenant: ORG_ID, role: 'list-viewer', resource: { type: 'SelectionList', key: LIST_ID } },
      MACHINE_TOKEN,
    );
    // Revoke-first fails safe (a failure between the two leaves LESS access).
    expect(callLog.indexOf('authz:revoke')).toBeLessThan(callLog.indexOf('authz:grant'));
    expect(tables.selection_list_access.filter((r) => r.user_id === USER_ID)).toHaveLength(1);
  });

  it('is idempotent for the same role: no revoke', async () => {
    seedAccess(USER_ID, 'list-viewer');
    const revoke = jest.fn();
    _setAuthzClientForTesting(makeAuthzClient({ revoke }));

    const res = await put({ role: 'list-viewer' });

    expect(res.status).toBe(200);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('re-granting a previously revoked user starts a new grant (granted_at restarts, revoked_at cleared)', async () => {
    seedAccess(USER_ID, 'list-viewer', { revoked_at: new Date('2026-01-05T00:00:00.000Z') });

    const res = await put({ role: 'list-viewer' });

    expect(res.status).toBe(200);
    expect(res.body.granted_at).toBe('2026-02-02T00:00:00.000Z');
    expect(accessRow(USER_ID)!.revoked_at).toBeNull();
  });

  it('returns 409 CONFLICT and writes nothing when demoting the last list-owner', async () => {
    seedAccess(USER_ID, 'list-owner');
    const grant = jest.fn();
    const revoke = jest.fn();
    _setAuthzClientForTesting(makeAuthzClient({ grant, revoke }));

    const res = await put({ role: 'list-editor' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(grant).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    expect(accessRow(USER_ID)!.role).toBe('list-owner');
  });

  it('allows demoting an owner when another owner exists', async () => {
    seedAccess(USER_ID, 'list-owner');
    seedAccess('usr_other_owner', 'list-owner');

    const res = await put({ role: 'list-editor' });

    expect(res.status).toBe(200);
    expect(accessRow(USER_ID)!.role).toBe('list-editor');
  });

  it('returns 500 and leaves the mirror UNCHANGED when AuthzClient.grant() throws (write-ordering fail-closed guarantee)', async () => {
    seedAccess(USER_ID, 'list-viewer');
    const grant = jest.fn().mockRejectedValue(new AuthzError('PROVIDER_ERROR', 'Security API returned 502'));
    _setAuthzClientForTesting(makeAuthzClient({ grant }));

    const res = await put({ role: 'list-editor' });

    expect(res.status).toBe(500);
    expect(accessRow(USER_ID)!.role).toBe('list-viewer');
    expect(callLog).not.toContain('mirror:upsert');
  });

  it('requires manage_access (flag ON): a denial is a 403 and nothing is written', async () => {
    process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'] = 'true';
    const check = jest.fn().mockResolvedValue({ allow: false });
    const grant = jest.fn();
    _setAuthzClientForTesting(makeAuthzClient({ check, grant }));

    const res = await put({ role: 'list-viewer' });

    expect(res.status).toBe(403);
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'manage_access', resource: { type: 'SelectionList', key: LIST_ID } }),
      expect.any(String),
    );
    expect(grant).not.toHaveBeenCalled();
  });

  const VALID_ROLES = ['list-owner', 'list-editor', 'list-contributor', 'list-translator', 'list-viewer'];
  VALID_ROLES.forEach((role) => {
    it(`accepts valid role: ${role}`, async () => {
      const res = await put({ role });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe(role);
    });
  });
});

// ─── C) DELETE /:listId/access/:userId ───────────────────────────────────────
describe('DELETE /:listId/access/:userId', () => {
  const del = (userId = USER_ID) =>
    request(makeApp()).delete(`/lists/${LIST_ID}/access/${userId}`).set(auth());

  it('returns 401 with no token', async () => {
    const res = await request(makeApp()).delete(`/lists/${LIST_ID}/access/${USER_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 when the list is not in the caller\'s organization', async () => {
    tables.selection_lists = [{ id: LIST_ID, organization_id: 'org_other' }];
    const res = await del();
    expect(res.status).toBe(404);
  });

  it('returns 204 (idempotent) and calls nothing when no active grant exists', async () => {
    const revoke = jest.fn();
    _setAuthzClientForTesting(makeAuthzClient({ revoke }));

    const res = await del();

    expect(res.status).toBe(204);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('returns 409 CONFLICT and revokes nothing when removing the last list-owner', async () => {
    seedAccess(USER_ID, 'list-owner');
    const revoke = jest.fn();
    _setAuthzClientForTesting(makeAuthzClient({ revoke }));

    const res = await del();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(revoke).not.toHaveBeenCalled();
    expect(accessRow(USER_ID)!.revoked_at).toBeNull();
  });

  it('revokes an owner when another owner exists, scoping the revoke to this list instance', async () => {
    seedAccess(USER_ID, 'list-owner');
    seedAccess('usr_other_owner', 'list-owner');
    const revoke = jest.fn(async () => { callLog.push('authz:revoke'); });
    _setAuthzClientForTesting(makeAuthzClient({ revoke }));

    const res = await del();

    expect(res.status).toBe(204);
    // resource MUST reach the wire on revoke too — same rationale as grant.
    expect(revoke).toHaveBeenCalledWith(
      { subject: USER_ID, tenant: ORG_ID, role: 'list-owner', resource: { type: 'SelectionList', key: LIST_ID } },
      MACHINE_TOKEN,
    );
    expect(accessRow(USER_ID)!.revoked_at).not.toBeNull();
  });

  it('revokes a non-owner role and soft-deletes the mirror row AFTER the Security API call', async () => {
    seedAccess(USER_ID, 'list-viewer');

    const res = await del();

    expect(res.status).toBe(204);
    expect(callLog.indexOf('authz:revoke')).toBeLessThan(callLog.indexOf('update:selection_list_access'));
    expect(accessRow(USER_ID)!.revoked_at).not.toBeNull();
  });

  it('returns 500 and leaves the mirror UNCHANGED when AuthzClient.revoke() throws (write-ordering fail-closed guarantee)', async () => {
    seedAccess(USER_ID, 'list-viewer');
    const revoke = jest.fn().mockRejectedValue(new AuthzError('PROVIDER_ERROR', 'Security API returned 502'));
    _setAuthzClientForTesting(makeAuthzClient({ revoke }));

    const res = await del();

    expect(res.status).toBe(500);
    expect(accessRow(USER_ID)!.revoked_at).toBeNull();
    expect(callLog).not.toContain('update:selection_list_access');
  });

  it('returns 403 (fail closed) when the Security API check throws AuthzError(DECISION_UNAVAILABLE) with authz ON', async () => {
    process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'] = 'true';
    _setAuthzClientForTesting({
      check: jest.fn().mockRejectedValue(new AuthzError('DECISION_UNAVAILABLE', 'Security API request failed: timeout; denying.')),
      bulkCheck: jest.fn(),
      grant: jest.fn(),
      revoke: jest.fn(),
      listGrants: jest.fn(),
    } as unknown as AuthzClient);

    const res = await del();

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 403 when the Security API denies manage_access and authz is ON', async () => {
    process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'] = 'true';
    seedAccess(USER_ID, 'list-viewer');
    const check = jest.fn().mockResolvedValue({ allow: false });
    const revoke = jest.fn();
    _setAuthzClientForTesting(makeAuthzClient({ check, revoke }));

    const res = await del();

    expect(res.status).toBe(403);
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'manage_access' }),
      expect.any(String),
    );
    expect(revoke).not.toHaveBeenCalled();
  });
});

// ─── D) Machine identity: grant/revoke WRITES never use the end user's token ──
//
// Review C-1: the Security API is being fixed so a non-admin human is denied
// grant/revoke. These writes are therefore authenticated as THIS SERVICE
// (client_credentials, scope authz:admin — lib/machineIdentity.ts). Decisions
// about the human (route-level manage_access, the membership probe) keep using
// the human's token.
describe('machine identity for grant/revoke writes', () => {
  const userToken = () => makeToken();

  it('PUT: grant uses the machine token; the membership check keeps the end-user token', async () => {
    const check = jest.fn().mockResolvedValue({ allow: true });
    const grant = jest.fn(async () => ({ id: 'g1', subject: USER_ID, tenant: ORG_ID, role: 'list-viewer' }));
    _setAuthzClientForTesting(makeAuthzClient({ check, grant }));

    const res = await request(makeApp())
      .put(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set({ Authorization: `Bearer ${userToken()}` })
      .send({ role: 'list-viewer' });

    expect(res.status).toBe(200);
    expect(machineGetToken).toHaveBeenCalled();
    const [, grantToken] = (grant as jest.Mock).mock.calls[0];
    expect(grantToken).toBe(MACHINE_TOKEN);
    expect(grantToken).not.toBe(userToken());
    // Membership probe (a READ about the target) still carries the human's token.
    const [, checkToken] = check.mock.calls[0];
    expect(checkToken).toBe(userToken());
  });

  it('PUT: role change revokes the old role with the machine token too', async () => {
    seedAccess(USER_ID, 'list-viewer');
    const revoke = jest.fn(async () => undefined);
    _setAuthzClientForTesting(makeAuthzClient({ revoke }));

    const res = await request(makeApp())
      .put(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set(auth())
      .send({ role: 'list-editor' });

    expect(res.status).toBe(200);
    expect((revoke as jest.Mock).mock.calls[0][1]).toBe(MACHINE_TOKEN);
  });

  it('DELETE: revoke uses the machine token', async () => {
    seedAccess(USER_ID, 'list-viewer');
    const revoke = jest.fn(async () => undefined);
    _setAuthzClientForTesting(makeAuthzClient({ revoke }));

    const res = await request(makeApp()).delete(`/lists/${LIST_ID}/access/${USER_ID}`).set(auth());

    expect(res.status).toBe(204);
    expect((revoke as jest.Mock).mock.calls[0][1]).toBe(MACHINE_TOKEN);
  });

  it('PUT fails closed (500, no Security API write, mirror untouched) when the machine token cannot be minted', async () => {
    machineGetToken.mockRejectedValue(new Error('token issuance failed'));
    const grant = jest.fn();
    _setAuthzClientForTesting(makeAuthzClient({ grant }));

    const res = await request(makeApp())
      .put(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set(auth())
      .send({ role: 'list-viewer' });

    expect(res.status).toBe(500);
    expect(grant).not.toHaveBeenCalled();
    expect(accessRow(USER_ID)).toBeUndefined();
  });

  it('DELETE fails closed (500, nothing revoked, mirror untouched) when the machine token cannot be minted', async () => {
    seedAccess(USER_ID, 'list-viewer');
    machineGetToken.mockRejectedValue(new Error('token issuance failed'));
    const revoke = jest.fn();
    _setAuthzClientForTesting(makeAuthzClient({ revoke }));

    const res = await request(makeApp()).delete(`/lists/${LIST_ID}/access/${USER_ID}`).set(auth());

    expect(res.status).toBe(500);
    expect(revoke).not.toHaveBeenCalled();
    expect(accessRow(USER_ID)!.revoked_at).toBeNull();
  });

  it('malformed path ids are 400 VALIDATION_ERROR at the edge (before any DB / Security API call)', async () => {
    const check = jest.fn();
    _setAuthzClientForTesting(makeAuthzClient({ check }));
    const res = await request(makeApp()).delete(`/lists/not-a-list-id/access/${USER_ID}`).set(auth());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    const res2 = await request(makeApp()).delete(`/lists/${LIST_ID}/access/not-a-user`).set(auth());
    expect(res2.status).toBe(400);
    expect(res2.body.code).toBe('VALIDATION_ERROR');
    expect(check).not.toHaveBeenCalled();
  });
});
