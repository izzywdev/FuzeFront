// permit.middleware.test.ts — unit tests for S7 Permit.io middleware.
//
// Tests both flag OFF and flag ON paths.
// Uses _setPermitClientForTesting() to inject mocks — never hits a real Permit API.
//
// Flag OFF path  (4 tests): pass-through with no Permit call.
// Flag ON path   (6 tests): real check, fail-closed on error, grantListOwner, countActiveOwners.

// ─── Mock DB before any imports ───────────────────────────────────────────────
jest.mock('../src/db', () => {
  const mockQuery = jest.fn();
  const mockDb: any = jest.fn(() => mockDb);
  mockDb.fn = { now: () => new Date().toISOString() };
  // Chainable knex-like methods
  mockDb.where = jest.fn(() => mockDb);
  mockDb.whereNull = jest.fn(() => mockDb);
  mockDb.select = jest.fn(() => mockDb);
  mockDb.first = jest.fn(() => Promise.resolve(null));
  mockDb.count = jest.fn(() => mockDb);
  mockDb.insert = jest.fn(() => mockDb);
  mockDb.onConflict = jest.fn(() => mockDb);
  mockDb.merge = jest.fn(() => Promise.resolve(1));
  mockDb.update = jest.fn(() => Promise.resolve(1));
  mockDb.orderBy = jest.fn(() => mockDb);
  mockDb.limit = jest.fn(() => mockDb);
  mockQuery.mockResolvedValue([]);
  return { db: mockDb };
});

// ─── Imports ──────────────────────────────────────────────────────────────────
import express, { Request, Response } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import {
  requirePermit,
  _setPermitClientForTesting,
  makeNoOpProxy,
  grantListOwner,
  countActiveOwners,
} from '../src/middleware/permit';
import { db } from '../src/db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-s7-permit';
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { userId: 'usr_tester01', orgId: 'org_acme', ...overrides },
    JWT_SECRET,
  );
}

function buildApp(resource: string, action: string): express.Application {
  const app = express();
  app.use(express.json());

  // Minimal auth middleware that injects userId/orgId from JWT.
  app.use((req, _res, next) => {
    const auth = req.headers['authorization'];
    if (auth) {
      try {
        const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET) as any;
        req.userId = decoded.userId;
        req.orgId = decoded.orgId;
      } catch {
        /* ignore in test helper */
      }
    }
    next();
  });

  app.get(
    '/lists/:listId',
    requirePermit(resource, action),
    (_req: Request, res: Response) => res.status(200).json({ ok: true }),
  );
  return app;
}

// ─── Restore no-op between tests ──────────────────────────────────────────────
afterEach(() => {
  delete process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'];
  _setPermitClientForTesting(makeNoOpProxy());
});

// ─── Flag OFF tests ───────────────────────────────────────────────────────────
describe('requirePermit — flag OFF (default)', () => {
  beforeEach(() => {
    delete process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'];
  });

  it('passes through without calling Permit when flag is OFF', async () => {
    const mockPermit = { check: jest.fn() };
    _setPermitClientForTesting(mockPermit);
    const app = buildApp('SelectionList', 'read');

    const res = await request(app)
      .get('/lists/sl_abc123')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(mockPermit.check).not.toHaveBeenCalled();
  });

  it('returns 401 when no token present (flag OFF)', async () => {
    const app = buildApp('SelectionList', 'read');
    const res = await request(app).get('/lists/sl_abc123');
    expect(res.status).toBe(401);
  });

  it('passes through regardless of what Permit would return when flag is OFF', async () => {
    const mockPermit = { check: jest.fn().mockResolvedValue(false) }; // would deny
    _setPermitClientForTesting(mockPermit);
    const app = buildApp('SelectionList', 'admin');

    const res = await request(app)
      .get('/lists/sl_abc123')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(mockPermit.check).not.toHaveBeenCalled();
  });

  it('returns 401 when userId is missing from token (flag OFF)', async () => {
    // Token without userId claim → middleware should reject.
    const token = jwt.sign({ orgId: 'org_acme' }, JWT_SECRET);
    const app = buildApp('SelectionList', 'read');
    const res = await request(app)
      .get('/lists/sl_abc123')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

// ─── Flag ON tests ────────────────────────────────────────────────────────────
describe('requirePermit — flag ON', () => {
  beforeEach(() => {
    process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'] = 'true';
  });

  it('allows access when Permit.check returns true', async () => {
    const mockPermit = { check: jest.fn().mockResolvedValue(true) };
    _setPermitClientForTesting(mockPermit);
    const app = buildApp('SelectionList', 'read');

    const res = await request(app)
      .get('/lists/sl_abc123')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(mockPermit.check).toHaveBeenCalledWith(
      'usr_tester01',
      'read',
      { type: 'SelectionList', tenant: 'org_acme', key: 'sl_abc123' },
    );
  });

  it('returns 403 when Permit.check returns false', async () => {
    const mockPermit = { check: jest.fn().mockResolvedValue(false) };
    _setPermitClientForTesting(mockPermit);
    const app = buildApp('SelectionList', 'admin');

    const res = await request(app)
      .get('/lists/sl_abc123')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 403 (fail closed) when Permit.check throws', async () => {
    const mockPermit = { check: jest.fn().mockRejectedValue(new Error('Permit network error')) };
    _setPermitClientForTesting(mockPermit);
    const app = buildApp('SelectionList', 'read');

    const res = await request(app)
      .get('/lists/sl_abc123')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('calls Permit with correct resource instance key from route param', async () => {
    const mockPermit = { check: jest.fn().mockResolvedValue(true) };
    _setPermitClientForTesting(mockPermit);
    const app = buildApp('SelectionList', 'write');

    await request(app)
      .get('/lists/sl_unique999')
      .set('Authorization', `Bearer ${makeToken()}`);

    const [userId, action, resourceInstance] = mockPermit.check.mock.calls[0];
    expect(userId).toBe('usr_tester01');
    expect(action).toBe('write');
    expect(resourceInstance).toMatchObject({ key: 'sl_unique999', tenant: 'org_acme' });
  });
});

// ─── grantListOwner ───────────────────────────────────────────────────────────
describe('grantListOwner', () => {
  const mockDb = db as jest.MockedFunction<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore Knex chain mock after clearAllMocks.
    mockDb.mockImplementation(() => mockDb);
    mockDb.insert = jest.fn(() => mockDb);
    mockDb.onConflict = jest.fn(() => mockDb);
    mockDb.merge = jest.fn(() => Promise.resolve(1));
    mockDb.fn = { now: () => new Date().toISOString() };
  });

  it('calls Permit.api.roleAssignments.assign and then upserts the mirror row', async () => {
    const assignMock = jest.fn().mockResolvedValue(undefined);
    const mockPermit = {
      api: { roleAssignments: { assign: assignMock } },
    };
    _setPermitClientForTesting(mockPermit);

    await grantListOwner('usr_newowner', 'org_acme', 'sl_mylist', 'usr_admin');

    expect(assignMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'usr_newowner',
        role: 'list-owner',
        tenant: 'org_acme',
        resource_instance: 'SelectionList:sl_mylist',
      }),
    );
    expect(mockDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        list_id: 'sl_mylist',
        user_id: 'usr_newowner',
        role: 'list-owner',
        granted_by: 'usr_admin',
        org_id: 'org_acme',
        revoked_at: null,
      }),
    );
  });
});

// ─── countActiveOwners ────────────────────────────────────────────────────────
describe('countActiveOwners', () => {
  const mockDb = db as jest.MockedFunction<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.mockImplementation(() => mockDb);
    mockDb.where = jest.fn(() => mockDb);
    mockDb.whereNull = jest.fn(() => mockDb);
    mockDb.count = jest.fn(() => mockDb);
    mockDb.first = jest.fn(() => Promise.resolve({ count: '3' }));
  });

  it('returns parsed integer count from mirror table', async () => {
    const result = await countActiveOwners('sl_mylist');
    expect(result).toBe(3);
    expect(mockDb).toHaveBeenCalledWith('selection_list_access');
    expect(mockDb.where).toHaveBeenCalledWith({ list_id: 'sl_mylist', role: 'list-owner' });
    expect(mockDb.whereNull).toHaveBeenCalledWith('revoked_at');
  });

  it('returns 0 when first() returns null (no rows)', async () => {
    mockDb.first = jest.fn(() => Promise.resolve(null));
    const result = await countActiveOwners('sl_empty');
    expect(result).toBe(0);
  });
});
