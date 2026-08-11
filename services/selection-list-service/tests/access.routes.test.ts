// access.routes.test.ts — integration tests for S7 access grant endpoints.
//
// Covers:
//  A) GET /:listId/access    — cursor-paginated roster (flag OFF and flag ON)
//  B) PUT /:listId/access/:userId  — grant/update role
//  C) DELETE /:listId/access/:userId  — revoke access
//
// DB is mocked via jest.mock('../src/db'); Permit client is injected via
// _setPermitClientForTesting(); feature flag is controlled via env var.

// ─── Mock DB before any imports ───────────────────────────────────────────────
jest.mock('../src/db', () => {
  const mockDb: any = jest.fn(() => mockDb);
  mockDb.fn = { now: () => 'NOW()' };
  mockDb.where = jest.fn(() => mockDb);
  mockDb.whereNull = jest.fn(() => mockDb);
  mockDb.whereNotNull = jest.fn(() => mockDb);
  mockDb.select = jest.fn(() => mockDb);
  mockDb.first = jest.fn(() => Promise.resolve(null));
  mockDb.count = jest.fn(() => mockDb);
  mockDb.orderBy = jest.fn(() => mockDb);
  mockDb.limit = jest.fn(() => mockDb);
  mockDb.insert = jest.fn(() => mockDb);
  mockDb.onConflict = jest.fn(() => mockDb);
  mockDb.merge = jest.fn(() => Promise.resolve(1));
  mockDb.update = jest.fn(() => Promise.resolve(1));
  // Default: query returns empty array
  mockDb.then = undefined; // prevent accidental Promise treatment
  return { db: mockDb };
});

// ─── Imports ──────────────────────────────────────────────────────────────────
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import accessRouter from '../src/routes/access';
import { _setPermitClientForTesting, makeNoOpProxy } from '../src/middleware/permit';
import { db } from '../src/db';

// ─── Constants ────────────────────────────────────────────────────────────────
const JWT_SECRET = 'test-secret-s7-access-routes';
process.env.JWT_SECRET = JWT_SECRET;

const LIST_ID = 'sl_testlist01';
const USER_ID = 'usr_alice';
const ACTOR_ID = 'usr_admin';
const ORG_ID = 'org_corp';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { userId: ACTOR_ID, orgId: ORG_ID, ...overrides },
    JWT_SECRET,
  );
}

function makeApp(): express.Application {
  const app = express();
  app.use(express.json());
  // Mount under /lists so :listId and :userId params resolve correctly.
  app.use('/lists', accessRouter);
  return app;
}

const mockDb = db as jest.MockedFunction<any>;

/** Re-establish the Knex chain mock after jest.clearAllMocks() wipes it. */
function restoreDbMock(): void {
  mockDb.mockImplementation(() => mockDb);
  mockDb.fn = { now: () => 'NOW()' };
  mockDb.where = jest.fn(() => mockDb);
  mockDb.whereNull = jest.fn(() => mockDb);
  mockDb.whereNotNull = jest.fn(() => mockDb);
  mockDb.select = jest.fn(() => mockDb);
  mockDb.first = jest.fn(() => Promise.resolve(null));
  mockDb.count = jest.fn(() => mockDb);
  mockDb.orderBy = jest.fn(() => mockDb);
  mockDb.limit = jest.fn(() => mockDb);
  mockDb.insert = jest.fn(() => mockDb);
  mockDb.onConflict = jest.fn(() => mockDb);
  mockDb.merge = jest.fn(() => Promise.resolve(1));
  mockDb.update = jest.fn(() => Promise.resolve(1));
}

// Default Permit mock: allow everything.
function makeAllowPermit(): any {
  return { check: jest.fn().mockResolvedValue(true) };
}

afterEach(() => {
  delete process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'];
  _setPermitClientForTesting(makeNoOpProxy());
  jest.clearAllMocks();
  restoreDbMock();
});

// ─── A) GET /:listId/access ───────────────────────────────────────────────────
describe('GET /:listId/access', () => {
  it('returns 401 with no token', async () => {
    const app = makeApp();
    const res = await request(app).get(`/lists/${LIST_ID}/access`);
    expect(res.status).toBe(401);
  });

  it('returns paginated envelope with items and page metadata (flag OFF)', async () => {
    const rows = [
      { user_id: 'usr_a', role: 'list-owner', granted_by: 'usr_admin', granted_at: '2026-01-01', updated_at: '2026-01-01', org_id: ORG_ID },
      { user_id: 'usr_b', role: 'list-viewer', granted_by: 'usr_admin', granted_at: '2026-01-02', updated_at: '2026-01-02', org_id: ORG_ID },
    ];
    // Simulate limit+1 query returning exactly the rows (no hasMore).
    mockDb.limit = jest.fn(() => ({ then: (fn: any) => Promise.resolve(fn(rows)) }));

    // Knex chain re-wire so mockDb('table').where().whereNull().orderBy().limit() works.
    mockDb.mockImplementation(() => mockDb);
    mockDb.where = jest.fn(() => mockDb);
    mockDb.whereNull = jest.fn(() => mockDb);
    mockDb.orderBy = jest.fn(() => mockDb);
    mockDb.select = jest.fn(() => mockDb);
    // limit is the last call before the implicit query execution.
    mockDb.limit = jest.fn(() => Promise.resolve(rows));

    const app = makeApp();
    const res = await request(app)
      .get(`/lists/${LIST_ID}/access`)
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('page');
    expect(res.body.page).toHaveProperty('nextCursor');
    expect(res.body.page).toHaveProperty('hasMore');
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('clamps limit to MAX_LIMIT (200) server-side', async () => {
    restoreDbMock();
    mockDb.limit = jest.fn(() => Promise.resolve([]));

    const app = makeApp();
    await request(app)
      .get(`/lists/${LIST_ID}/access?limit=9999`)
      .set('Authorization', `Bearer ${makeToken()}`);

    // The limit call should have been made with at most MAX_LIMIT + 1 = 201
    expect(mockDb.limit).toHaveBeenCalledWith(expect.any(Number));
    const calledWith = mockDb.limit.mock.calls[0][0];
    expect(calledWith).toBeLessThanOrEqual(201); // MAX_LIMIT + 1
  });

  it('uses cursor for pagination (decodes base64url into user_id filter)', async () => {
    restoreDbMock();
    mockDb.limit = jest.fn(() => Promise.resolve([]));

    const cursor = Buffer.from('usr_zzz', 'utf8').toString('base64url');
    const app = makeApp();
    await request(app)
      .get(`/lists/${LIST_ID}/access?cursor=${cursor}`)
      .set('Authorization', `Bearer ${makeToken()}`);

    // The where clause with '>' should have been called for the cursor.
    const whereCalls = mockDb.where.mock.calls;
    const cursorCall = whereCalls.find((c: any[]) => c[0] === 'user_id' && c[1] === '>');
    expect(cursorCall).toBeDefined();
    expect(cursorCall[2]).toBe('usr_zzz');
  });

  it('returns nextCursor when there are more pages', async () => {
    restoreDbMock();
    // Return 51 rows (more than default limit of 50) so hasMore = true.
    const rows = Array.from({ length: 51 }, (_, i) => ({
      user_id: `usr_${String(i).padStart(3, '0')}`,
      role: 'list-viewer',
      granted_by: 'usr_admin',
      granted_at: '2026-01-01',
      updated_at: '2026-01-01',
      org_id: ORG_ID,
    }));
    mockDb.limit = jest.fn(() => Promise.resolve(rows));

    const app = makeApp();
    const res = await request(app)
      .get(`/lists/${LIST_ID}/access`)
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.page.hasMore).toBe(true);
    expect(res.body.page.nextCursor).not.toBeNull();
    // Items should be exactly 50, not 51.
    expect(res.body.items).toHaveLength(50);
  });

  it('returns nextCursor: null when no more pages', async () => {
    restoreDbMock();
    const rows = [
      { user_id: 'usr_only', role: 'list-owner', granted_by: 'usr_admin', granted_at: '2026-01-01', updated_at: '2026-01-01', org_id: ORG_ID },
    ];
    mockDb.limit = jest.fn(() => Promise.resolve(rows));

    const app = makeApp();
    const res = await request(app)
      .get(`/lists/${LIST_ID}/access`)
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.page.hasMore).toBe(false);
    expect(res.body.page.nextCursor).toBeNull();
  });
});

// ─── B) PUT /:listId/access/:userId ──────────────────────────────────────────
describe('PUT /:listId/access/:userId', () => {
  it('returns 401 with no token', async () => {
    const app = makeApp();
    const res = await request(app)
      .put(`/lists/${LIST_ID}/access/${USER_ID}`)
      .send({ role: 'list-viewer' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid role', async () => {
    const app = makeApp();
    const res = await request(app)
      .put(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ role: 'list-hacker' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ROLE');
  });

  it('returns 400 when role is missing', async () => {
    const app = makeApp();
    const res = await request(app)
      .put(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('grants list-viewer role successfully (flag OFF)', async () => {
    restoreDbMock();
    const mockPermit = {
      check: jest.fn().mockResolvedValue(true),
      api: { roleAssignments: { assign: jest.fn().mockResolvedValue(undefined) } },
    };
    _setPermitClientForTesting(mockPermit);

    const app = makeApp();
    const res = await request(app)
      .put(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ role: 'list-viewer' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: USER_ID,
      listId: LIST_ID,
      role: 'list-viewer',
    });
  });

  it('returns 409 when demoting last owner (flag OFF)', async () => {
    restoreDbMock();
    // existing row is list-owner.
    mockDb.first = jest.fn().mockResolvedValueOnce({ role: 'list-owner' });
    // countActiveOwners → only 1 owner.
    mockDb.count = jest.fn(() => mockDb);
    mockDb.first = jest.fn()
      .mockResolvedValueOnce({ role: 'list-owner' })  // existing grant check
      .mockResolvedValueOnce({ count: '1' });          // countActiveOwners

    const app = makeApp();
    const res = await request(app)
      .put(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ role: 'list-editor' }); // demoting from owner

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LAST_OWNER');
  });

  it('allows demoting an owner when another owner exists (flag OFF)', async () => {
    restoreDbMock();
    const assignMock = jest.fn().mockResolvedValue(undefined);
    _setPermitClientForTesting({
      check: jest.fn().mockResolvedValue(true),
      api: { roleAssignments: { assign: assignMock } },
    });

    // existing row is list-owner, but 2 owners exist.
    mockDb.first = jest.fn()
      .mockResolvedValueOnce({ role: 'list-owner' })
      .mockResolvedValueOnce({ count: '2' });

    const app = makeApp();
    const res = await request(app)
      .put(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ role: 'list-editor' });

    expect(res.status).toBe(200);
  });

  const VALID_ROLES = ['list-owner', 'list-editor', 'list-contributor', 'list-translator', 'list-viewer'];
  VALID_ROLES.forEach((role) => {
    it(`accepts valid role: ${role}`, async () => {
      jest.clearAllMocks();
      restoreDbMock();
      _setPermitClientForTesting(makeNoOpProxy());
      const mockPermit = {
        check: jest.fn().mockResolvedValue(true),
        api: { roleAssignments: { assign: jest.fn().mockResolvedValue(undefined) } },
      };
      _setPermitClientForTesting(mockPermit);

      const app = makeApp();
      const res = await request(app)
        .put(`/lists/${LIST_ID}/access/${USER_ID}`)
        .set('Authorization', `Bearer ${makeToken()}`)
        .send({ role });

      // Any 2xx or role-specific 409 is acceptable; 400 is not.
      expect(res.status).not.toBe(400);
    });
  });
});

// ─── C) DELETE /:listId/access/:userId ───────────────────────────────────────
describe('DELETE /:listId/access/:userId', () => {
  it('returns 401 with no token', async () => {
    const app = makeApp();
    const res = await request(app).delete(`/lists/${LIST_ID}/access/${USER_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 204 (idempotent) when no active grant exists', async () => {
    restoreDbMock();
    mockDb.first = jest.fn().mockResolvedValue(null); // no active grant

    const app = makeApp();
    const res = await request(app)
      .delete(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(204);
  });

  it('returns 409 when removing last owner', async () => {
    restoreDbMock();
    mockDb.first = jest.fn()
      .mockResolvedValueOnce({ role: 'list-owner' })   // existing grant
      .mockResolvedValueOnce({ count: '1' });           // countActiveOwners

    const app = makeApp();
    const res = await request(app)
      .delete(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LAST_OWNER');
  });

  it('revokes access and returns 204 when not last owner', async () => {
    restoreDbMock();
    const unassignMock = jest.fn().mockResolvedValue(undefined);
    _setPermitClientForTesting({
      check: jest.fn().mockResolvedValue(true),
      api: { roleAssignments: { unassign: unassignMock } },
    });

    mockDb.first = jest.fn()
      .mockResolvedValueOnce({ role: 'list-owner' })    // existing grant
      .mockResolvedValueOnce({ count: '2' });            // countActiveOwners → 2 owners

    const app = makeApp();
    const res = await request(app)
      .delete(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(204);
    expect(unassignMock).toHaveBeenCalled();
  });

  it('revokes a non-owner role successfully', async () => {
    restoreDbMock();
    const unassignMock = jest.fn().mockResolvedValue(undefined);
    _setPermitClientForTesting({
      check: jest.fn().mockResolvedValue(true),
      api: { roleAssignments: { unassign: unassignMock } },
    });

    mockDb.first = jest.fn().mockResolvedValueOnce({ role: 'list-viewer' }); // non-owner

    const app = makeApp();
    const res = await request(app)
      .delete(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(204);
    expect(unassignMock).toHaveBeenCalled();
  });

  it('returns 403 (fail closed) when Permit.io check throws during authz ON', async () => {
    process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'] = 'true';
    _setPermitClientForTesting({
      check: jest.fn().mockRejectedValue(new Error('Permit.io timeout')),
    });

    const app = makeApp();
    const res = await request(app)
      .delete(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 403 when Permit.check denies delete and flag is ON', async () => {
    process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'] = 'true';
    _setPermitClientForTesting({
      check: jest.fn().mockResolvedValue(false),
    });

    const app = makeApp();
    const res = await request(app)
      .delete(`/lists/${LIST_ID}/access/${USER_ID}`)
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(403);
  });
});
