// authz.middleware.test.ts — unit tests for S7 authz middleware, now routed
// through FuzeFront's Security API (@fuzefront/auth's AuthzClient) instead of
// an embedded Permit.io SDK.
//
// Tests both flag OFF and flag ON paths.
// Uses _setAuthzClientForTesting() to inject mocks — never hits a real
// Security API / network.
//
// Flag OFF path  (4 tests): pass-through with no Security API call.
// Flag ON  path  (7 tests): real check, fail-closed on error (including the
//                explicit DECISION_UNAVAILABLE case), grantListOwner
//                (including its own throw-must-not-write-mirror path),
//                countActiveOwners.

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
import { AuthzClient, AuthzError } from '@fuzefront/auth';
import {
  requireAuthzCheck,
  _setAuthzClientForTesting,
  makeNoOpProxy,
  grantListOwner,
  countActiveOwners,
} from '../src/middleware/authz';
import { db } from '../src/db';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-s7-authz';
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
    requireAuthzCheck(resource, action),
    (_req: Request, res: Response) => res.status(200).json({ ok: true }),
  );
  return app;
}

// ─── Restore no-op between tests ──────────────────────────────────────────────
afterEach(() => {
  delete process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'];
  _setAuthzClientForTesting(makeNoOpProxy());
});

// ─── Flag OFF tests ───────────────────────────────────────────────────────────
describe('requireAuthzCheck — flag OFF (default)', () => {
  beforeEach(() => {
    delete process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'];
  });

  it('passes through without calling the Security API when flag is OFF', async () => {
    const check = jest.fn();
    _setAuthzClientForTesting({ check, bulkCheck: jest.fn() } as unknown as AuthzClient);
    const app = buildApp('SelectionList', 'read');

    const res = await request(app)
      .get('/lists/sl_abc123')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(check).not.toHaveBeenCalled();
  });

  it('returns 401 when no token present (flag OFF)', async () => {
    const app = buildApp('SelectionList', 'read');
    const res = await request(app).get('/lists/sl_abc123');
    expect(res.status).toBe(401);
  });

  it('passes through regardless of what the Security API would return when flag is OFF', async () => {
    const check = jest.fn().mockResolvedValue({ allow: false }); // would deny
    _setAuthzClientForTesting({ check, bulkCheck: jest.fn() } as unknown as AuthzClient);
    const app = buildApp('SelectionList', 'admin');

    const res = await request(app)
      .get('/lists/sl_abc123')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(check).not.toHaveBeenCalled();
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
describe('requireAuthzCheck — flag ON', () => {
  beforeEach(() => {
    process.env['FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED'] = 'true';
  });

  it('allows access when the Security API returns { allow: true }', async () => {
    const check = jest.fn().mockResolvedValue({ allow: true });
    _setAuthzClientForTesting({ check, bulkCheck: jest.fn() } as unknown as AuthzClient);
    const app = buildApp('SelectionList', 'read');

    const res = await request(app)
      .get('/lists/sl_abc123')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(check).toHaveBeenCalledWith(
      {
        subject: 'usr_tester01',
        tenant: 'org_acme',
        resource: { type: 'SelectionList', key: 'sl_abc123' },
        action: 'read',
      },
      expect.any(String),
    );
  });

  it('returns 403 when the Security API returns { allow: false }', async () => {
    const check = jest.fn().mockResolvedValue({ allow: false });
    _setAuthzClientForTesting({ check, bulkCheck: jest.fn() } as unknown as AuthzClient);
    const app = buildApp('SelectionList', 'admin');

    const res = await request(app)
      .get('/lists/sl_abc123')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 403 (fail closed) when the Security API check throws a generic error', async () => {
    const check = jest.fn().mockRejectedValue(new Error('Security API network error'));
    _setAuthzClientForTesting({ check, bulkCheck: jest.fn() } as unknown as AuthzClient);
    const app = buildApp('SelectionList', 'read');

    const res = await request(app)
      .get('/lists/sl_abc123')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 403 (fail closed) when the Security API throws AuthzError(DECISION_UNAVAILABLE) — the timeout/unreachable case', async () => {
    const check = jest
      .fn()
      .mockRejectedValue(new AuthzError('DECISION_UNAVAILABLE', 'Security API request failed: timeout; denying.'));
    _setAuthzClientForTesting({ check, bulkCheck: jest.fn() } as unknown as AuthzClient);
    const app = buildApp('SelectionList', 'read');

    const res = await request(app)
      .get('/lists/sl_abc123')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('calls the Security API with correct resource instance key from route param', async () => {
    const check = jest.fn().mockResolvedValue({ allow: true });
    _setAuthzClientForTesting({ check, bulkCheck: jest.fn() } as unknown as AuthzClient);
    const app = buildApp('SelectionList', 'write');

    await request(app)
      .get('/lists/sl_unique999')
      .set('Authorization', `Bearer ${makeToken()}`);

    const [checkArg, tokenArg] = check.mock.calls[0];
    expect(checkArg.subject).toBe('usr_tester01');
    expect(checkArg.action).toBe('write');
    expect(checkArg).toMatchObject({ resource: { type: 'SelectionList', key: 'sl_unique999' }, tenant: 'org_acme' });
    expect(typeof tokenArg).toBe('string');
  });

  it('forwards the CALLER bearer token to the Security API, not a service-wide credential', async () => {
    const check = jest.fn().mockResolvedValue({ allow: true });
    _setAuthzClientForTesting({ check, bulkCheck: jest.fn() } as unknown as AuthzClient);
    const app = buildApp('SelectionList', 'read');
    const token = makeToken({ userId: 'usr_specific_caller' });

    await request(app).get('/lists/sl_abc123').set('Authorization', `Bearer ${token}`);

    const [, tokenArg] = check.mock.calls[0];
    expect(tokenArg).toBe(token);
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

  it('calls AuthzClient.grant() with an INSTANCE-scoped resource, then upserts the mirror row', async () => {
    const grantMock = jest.fn().mockResolvedValue({
      id: 'org_acme:usr_newowner:list-owner',
      subject: 'usr_newowner',
      tenant: 'org_acme',
      role: 'list-owner',
    });
    _setAuthzClientForTesting({
      check: jest.fn(),
      bulkCheck: jest.fn(),
      grant: grantMock,
      revoke: jest.fn(),
      listGrants: jest.fn(),
    } as unknown as AuthzClient);

    await grantListOwner('usr_newowner', 'org_acme', 'sl_mylist', 'usr_admin', 'caller-token');

    // The resource MUST reach the wire — omitting it silently widens a
    // list-scoped grant to tenant-wide (the exact bug this test guards).
    expect(grantMock).toHaveBeenCalledWith(
      {
        subject: 'usr_newowner',
        tenant: 'org_acme',
        role: 'list-owner',
        resource: { type: 'SelectionList', key: 'sl_mylist' },
      },
      'caller-token',
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

    // Ordering guarantee: the Security API write happened BEFORE the mirror
    // upsert, asserted via invocationCallOrder so a future reordering
    // regression fails loudly rather than silently by coincidence.
    const grantOrder = grantMock.mock.invocationCallOrder[0];
    const insertOrder = mockDb.insert.mock.invocationCallOrder[0];
    expect(grantOrder).toBeLessThan(insertOrder);
  });

  it('does NOT write the mirror row when AuthzClient.grant() throws — the write-ordering fail-closed guarantee', async () => {
    const grantMock = jest.fn().mockRejectedValue(new AuthzError('PROVIDER_ERROR', 'Security API returned 502'));
    _setAuthzClientForTesting({
      check: jest.fn(),
      bulkCheck: jest.fn(),
      grant: grantMock,
      revoke: jest.fn(),
      listGrants: jest.fn(),
    } as unknown as AuthzClient);

    await expect(
      grantListOwner('usr_newowner', 'org_acme', 'sl_mylist', 'usr_admin', 'caller-token'),
    ).rejects.toThrow();

    // The mirror upsert must never be reached — a caller retrying/observing
    // this failure must not find a mirror row claiming a grant that never
    // actually happened in the authorization backend.
    expect(mockDb.insert).not.toHaveBeenCalled();
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
