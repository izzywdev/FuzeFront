// quota.route.test.ts — Integration tests for quota routes and middleware (S6).
//
// Tests both flag-OFF and flag-ON paths, auth guard, and response envelope shape.
// Uses the setFlagClient DI seam to control feature flag behaviour without Unleash.
//
// Structure:
//  A) GET /v1/selection-lists/quota — tested against a standalone Express app
//     (quota route + flag middleware only, no DB calls in the route itself)
//  B) enforceListQuota / enforceItemQuota — tested against standalone minimal
//     Express apps so we don't need to mock the full S4 DB handlers.

// ─── Mock the quota service before any imports ────────────────────────────────

jest.mock('../src/services/quota.service', () => {
  class QuotaExceededError extends Error {
    constructor(
      public scope: string,
      public current: number,
      public limit: number,
      public resource: string,
    ) {
      super(`Quota exceeded: ${resource} ${current}/${limit} in scope ${scope}`);
      this.name = 'QuotaExceededError';
      Object.setPrototypeOf(this, QuotaExceededError.prototype);
    }
  }
  return {
    getQuotaUsage: jest.fn(),
    checkListQuota: jest.fn(),
    checkItemQuota: jest.fn(),
    QuotaExceededError,
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { setFlagClient } from '../src/flags';
import quotaRouter from '../src/routes/quota';
import { enforceListQuota, enforceItemQuota } from '../src/middleware/quota';
import { getQuotaUsage, checkListQuota, checkItemQuota, QuotaExceededError } from '../src/services/quota.service';

const mockGetQuotaUsage = getQuotaUsage as jest.MockedFunction<typeof getQuotaUsage>;
const mockCheckListQuota = checkListQuota as jest.MockedFunction<typeof checkListQuota>;
const mockCheckItemQuota = checkItemQuota as jest.MockedFunction<typeof checkItemQuota>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-s6-quota';

function makeToken(payload: Record<string, unknown> = {}): string {
  return jwt.sign(
    { userId: 'usr_testuser', orgId: 'org_testorg', ...payload },
    JWT_SECRET,
  );
}

/** An in-memory flag client that returns a fixed boolean value. */
function flagClient(enabled: boolean) {
  return {
    getBooleanValue: jest.fn().mockResolvedValue(enabled),
  };
}

/** A well-formed QuotaUsage fixture matching the OpenAPI SelectionListQuotaStatus shape. */
const QUOTA_FIXTURE = {
  organization_id: 'org_testorg',
  quotas: [
    { scope: 'org_lists', applies_to: 'organization', limit: 100, current: 12 },
    { scope: 'user_lists', applies_to: 'user', limit: 20, current: 3 },
    { scope: 'list_items', applies_to: 'list', limit: 500, current: null },
    { scope: 'list_locales', applies_to: 'list', limit: 11, current: null },
  ],
};

// ─── App A: Quota GET route only (with JWT auth) ──────────────────────────────
//
// Minimal app: auth middleware + quota router. No DB calls in the quota
// endpoint itself (getQuotaUsage is mocked), so no DB setup needed.

function makeQuotaApp() {
  const app = express();
  app.use(express.json());

  // Simplified auth: extract JWT manually (same logic as authMiddleware)
  app.use('/v1', (req, _res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];
    if (!token) { return next(); }
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.userId = decoded.userId;
      req.orgId = decoded.orgId;
    } catch { /* invalid token — leave userId/orgId unset */ }
    next();
  });

  // The auth guard (for 401 on missing token): a separate middleware
  app.use('/v1/selection-lists', (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'No token.' });
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'No token.' });
    }
    try {
      jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Invalid token.' });
    }
  });

  app.use('/v1/selection-lists', quotaRouter);
  return app;
}

// ─── App B: Minimal app for middleware testing (no JWT needed) ─────────────────
//
// We inject orgId/userId directly via a setup middleware so we don't need to
// involve JWT signing in middleware-focused tests.

function makeListMiddlewareApp(orgId?: string, userId?: string) {
  const app = express();
  app.use(express.json());
  // Inject identity context (what authMiddleware normally does from JWT).
  app.use((req, _res, next) => {
    if (orgId !== undefined) req.orgId = orgId;
    if (userId !== undefined) req.userId = userId;
    next();
  });
  // Middleware under test + a dummy handler
  app.post('/lists', enforceListQuota, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

function makeItemMiddlewareApp(orgId?: string, userId?: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (orgId !== undefined) req.orgId = orgId;
    if (userId !== undefined) req.userId = userId;
    next();
  });
  app.post('/lists/:listId/items', enforceItemQuota, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

beforeEach(() => {
  jest.clearAllMocks();
  setFlagClient(null); // reset to default (off) between tests
});

afterEach(() => {
  setFlagClient(null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// A. GET /v1/selection-lists/quota
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /v1/selection-lists/quota — flag OFF (default, no client)', () => {
  it('returns 404 when no flag client is installed (release default OFF)', async () => {
    setFlagClient(null); // no client → isSelectionListsEnabled returns false
    const app = makeQuotaApp();
    const token = makeToken();

    const res = await request(app)
      .get('/v1/selection-lists/quota')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('does NOT call getQuotaUsage when the flag is OFF', async () => {
    setFlagClient(flagClient(false));
    const app = makeQuotaApp();
    const token = makeToken();

    await request(app)
      .get('/v1/selection-lists/quota')
      .set('Authorization', `Bearer ${token}`);

    expect(mockGetQuotaUsage).not.toHaveBeenCalled();
  });
});

describe('GET /v1/selection-lists/quota — auth guard', () => {
  beforeEach(() => setFlagClient(flagClient(true)));

  it('returns 401 when no Authorization header is provided', async () => {
    const app = makeQuotaApp();
    const res = await request(app).get('/v1/selection-lists/quota');
    expect(res.status).toBe(401);
  });

  it('returns 401 when the JWT is malformed', async () => {
    const app = makeQuotaApp();
    const res = await request(app)
      .get('/v1/selection-lists/quota')
      .set('Authorization', 'Bearer not-a-valid-jwt');
    expect(res.status).toBe(401);
  });

  it('returns 401 when orgId claim is missing from JWT', async () => {
    const app = makeQuotaApp();
    // Token with userId but no orgId
    const tokenNoOrg = jwt.sign({ userId: 'usr_testuser' }, JWT_SECRET);

    const res = await request(app)
      .get('/v1/selection-lists/quota')
      .set('Authorization', `Bearer ${tokenNoOrg}`);

    // quotaRouter handler checks req.orgId and returns 401 when it's absent
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/selection-lists/quota — flag ON, happy path', () => {
  beforeEach(() => setFlagClient(flagClient(true)));

  it('returns 200 with the SelectionListQuotaStatus envelope', async () => {
    mockGetQuotaUsage.mockResolvedValue(QUOTA_FIXTURE as any);
    const app = makeQuotaApp();
    const token = makeToken();

    const res = await request(app)
      .get('/v1/selection-lists/quota')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.organization_id).toBe('org_testorg');
    expect(res.body.quotas).toHaveLength(4);
  });

  it('response quotas array has all 4 required scopes', async () => {
    mockGetQuotaUsage.mockResolvedValue(QUOTA_FIXTURE as any);
    const app = makeQuotaApp();
    const token = makeToken();

    const res = await request(app)
      .get('/v1/selection-lists/quota')
      .set('Authorization', `Bearer ${token}`);

    const scopes = res.body.quotas.map((q: any) => q.scope);
    expect(scopes).toContain('org_lists');
    expect(scopes).toContain('user_lists');
    expect(scopes).toContain('list_items');
    expect(scopes).toContain('list_locales');
  });

  it('each quota entry has required fields: scope, applies_to, limit, current', async () => {
    mockGetQuotaUsage.mockResolvedValue(QUOTA_FIXTURE as any);
    const app = makeQuotaApp();
    const token = makeToken();

    const res = await request(app)
      .get('/v1/selection-lists/quota')
      .set('Authorization', `Bearer ${token}`);

    for (const entry of res.body.quotas) {
      expect(entry).toHaveProperty('scope');
      expect(entry).toHaveProperty('applies_to');
      expect(typeof entry.limit).toBe('number');
      // current is integer or null
      expect(entry.current === null || typeof entry.current === 'number').toBe(true);
    }
  });

  it('list_items and list_locales have current=null (per-list ceilings)', async () => {
    mockGetQuotaUsage.mockResolvedValue(QUOTA_FIXTURE as any);
    const app = makeQuotaApp();
    const token = makeToken();

    const res = await request(app)
      .get('/v1/selection-lists/quota')
      .set('Authorization', `Bearer ${token}`);

    const listItems = res.body.quotas.find((q: any) => q.scope === 'list_items');
    const listLocales = res.body.quotas.find((q: any) => q.scope === 'list_locales');
    expect(listItems.current).toBeNull();
    expect(listLocales.current).toBeNull();
  });

  it('passes orgId and userId from JWT to getQuotaUsage', async () => {
    mockGetQuotaUsage.mockResolvedValue(QUOTA_FIXTURE as any);
    const app = makeQuotaApp();
    const token = makeToken({ userId: 'usr_myuser', orgId: 'org_myorg' });

    await request(app)
      .get('/v1/selection-lists/quota')
      .set('Authorization', `Bearer ${token}`);

    expect(mockGetQuotaUsage).toHaveBeenCalledWith('org_myorg', 'usr_myuser');
  });

  it('returns 500 when getQuotaUsage throws unexpectedly', async () => {
    mockGetQuotaUsage.mockRejectedValue(new Error('DB down'));
    const app = makeQuotaApp();
    const token = makeToken();

    const res = await request(app)
      .get('/v1/selection-lists/quota')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. enforceListQuota middleware
// ═══════════════════════════════════════════════════════════════════════════════

describe('enforceListQuota middleware — flag OFF', () => {
  it('returns 404 when the feature flag is OFF', async () => {
    setFlagClient(flagClient(false));
    const app = makeListMiddlewareApp('org_testorg', 'usr_testuser');

    const res = await request(app).post('/lists').send({});

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('does NOT call checkListQuota when flag is OFF', async () => {
    setFlagClient(flagClient(false));
    const app = makeListMiddlewareApp('org_testorg', 'usr_testuser');

    await request(app).post('/lists').send({});

    expect(mockCheckListQuota).not.toHaveBeenCalled();
  });
});

describe('enforceListQuota middleware — flag ON', () => {
  beforeEach(() => setFlagClient(flagClient(true)));

  it('returns 401 when orgId is absent (no auth context)', async () => {
    const app = makeListMiddlewareApp(undefined, undefined); // no orgId

    const res = await request(app).post('/lists').send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('passes to the handler when quota is not exceeded', async () => {
    mockCheckListQuota.mockResolvedValue(undefined);
    const app = makeListMiddlewareApp('org_testorg', 'usr_testuser');

    const res = await request(app).post('/lists').send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockCheckListQuota).toHaveBeenCalledWith('org_testorg');
  });

  it('returns 403 QUOTA_EXCEEDED when org_lists ceiling is reached', async () => {
    mockCheckListQuota.mockRejectedValue(
      new QuotaExceededError('org_lists', 100, 100, 'lists'),
    );
    const app = makeListMiddlewareApp('org_testorg', 'usr_testuser');

    const res = await request(app).post('/lists').send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('QUOTA_EXCEEDED');
    expect(res.body.scope).toBe('org_lists');
    expect(res.body.current).toBe(100);
    expect(res.body.limit).toBe(100);
  });

  it('forwards non-quota errors to the error handler', async () => {
    mockCheckListQuota.mockRejectedValue(new Error('DB error'));
    const app = makeListMiddlewareApp('org_testorg', 'usr_testuser');
    // Add a simple error handler so supertest sees a real response
    app.use((err: Error, _req: any, res: any, _next: any) => {
      res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
    });

    const res = await request(app).post('/lists').send({});

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. enforceItemQuota middleware
// ═══════════════════════════════════════════════════════════════════════════════

describe('enforceItemQuota middleware — flag OFF', () => {
  it('returns 404 when the feature flag is OFF', async () => {
    setFlagClient(flagClient(false));
    const app = makeItemMiddlewareApp('org_testorg', 'usr_testuser');

    const res = await request(app)
      .post('/lists/front_sl_01test/items')
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('does NOT call checkItemQuota when flag is OFF', async () => {
    setFlagClient(flagClient(false));
    const app = makeItemMiddlewareApp('org_testorg', 'usr_testuser');

    await request(app).post('/lists/front_sl_01test/items').send({});

    expect(mockCheckItemQuota).not.toHaveBeenCalled();
  });
});

describe('enforceItemQuota middleware — flag ON', () => {
  beforeEach(() => setFlagClient(flagClient(true)));

  it('returns 401 when orgId is absent', async () => {
    const app = makeItemMiddlewareApp(undefined, undefined);

    const res = await request(app)
      .post('/lists/front_sl_01test/items')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('passes to the handler when item quota is not exceeded', async () => {
    mockCheckItemQuota.mockResolvedValue(undefined);
    const app = makeItemMiddlewareApp('org_testorg', 'usr_testuser');

    const res = await request(app)
      .post('/lists/front_sl_01test/items')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockCheckItemQuota).toHaveBeenCalledWith('front_sl_01test', 'org_testorg');
  });

  it('returns 403 QUOTA_EXCEEDED when list_items ceiling is reached', async () => {
    mockCheckItemQuota.mockRejectedValue(
      new QuotaExceededError('list_items', 500, 500, 'items'),
    );
    const app = makeItemMiddlewareApp('org_testorg', 'usr_testuser');

    const res = await request(app)
      .post('/lists/front_sl_01test/items')
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('QUOTA_EXCEEDED');
    expect(res.body.scope).toBe('list_items');
    expect(res.body.current).toBe(500);
    expect(res.body.limit).toBe(500);
  });
});
