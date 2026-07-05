/**
 * Unit/integration tests for api-token-auth middleware.
 *
 * DB, api-token service, and core authenticateToken are all mocked — no real
 * Postgres or JWT infrastructure required.
 */

// ── Module mocks ────────────────────────────────────────────────────────────

jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), { transaction: jest.fn() }),
}))

jest.mock('../src/services/api-token', () => ({
  verifyToken: jest.fn(),
  updateLastUsed: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: jest.fn((_req: any, _res: any, next: any) => next()),
}))

// ── Imports (after mocks) ────────────────────────────────────────────────────

import request from 'supertest'
import express, { Request, Response } from 'express'
import { db } from '../src/config/database'
import { verifyToken, updateLastUsed } from '../src/services/api-token'
import { authenticateToken } from '../src/middleware/auth'
import { authenticateFlexible, tokenAuthRateLimiter } from '../src/middleware/api-token-auth'

const dbMock = db as jest.MockedFunction<any>
const verifyTokenMock = verifyToken as jest.MockedFunction<typeof verifyToken>
const updateLastUsedMock = updateLastUsed as jest.MockedFunction<typeof updateLastUsed>
const authenticateTokenMock = authenticateToken as jest.MockedFunction<typeof authenticateToken>

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal express app that calls authenticateFlexible, then returns 200. */
function makeApp() {
  const app = express()
  app.use(express.json())
  app.get('/test', authenticateFlexible as any, (_req: Request, res: Response) => {
    res.json({ ok: true, user: (_req as any).user, apiToken: (_req as any).apiToken })
  })
  return app
}

/** Build an express app with the rate limiter mounted + a handler that always 401s. */
function makeRateLimitApp() {
  const app = express()
  app.use(express.json())
  // The rate limiter is applied first; then a handler that always returns 401
  // (simulates a failed ff_live_ auth from the perspective of the limiter).
  app.get(
    '/auth',
    tokenAuthRateLimiter,
    (_req: Request, res: Response) => {
      res.status(401).json({ error: 'Invalid token' })
    }
  )
  return app
}

/** Build a minimal valid ApiTokenRow for a PAT. */
function makePATToken(overrides: any = {}) {
  return {
    id: 'tok-pat-1',
    token_prefix: 'pref1234567890123456',
    owner_type: 'user' as const,
    owner_id: 'user-abc',
    name: 'My PAT',
    scopes: ['App:read'],
    expires_at: null,
    last_used_at: null,
    created_by: 'user-abc',
    revoked_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }
}

/** Build a minimal valid ApiTokenRow for a service token. */
function makeServiceToken(overrides: any = {}) {
  return {
    id: 'tok-svc-1',
    token_prefix: 'svcpref123456789012',
    owner_type: 'org' as const,
    owner_id: 'org-xyz',
    name: 'Service Token',
    scopes: ['App:read', 'App:create'],
    expires_at: null,
    last_used_at: null,
    created_by: 'user-admin',
    revoked_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }
}

/** Mock db('users').select(...).where(...).first() to resolve with a user row. */
function mockDbUserFound(userRow: any) {
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(userRow),
  }
  dbMock.mockReturnValue(chain)
  return chain
}

// ── Before each ──────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  updateLastUsedMock.mockResolvedValue(undefined)
})

// ── Tests ────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// No Authorization header
// ---------------------------------------------------------------------------
describe('no Authorization header', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const app = makeApp()
    const res = await request(app).get('/test')
    expect(res.status).toBe(401)
    expect(res.body.error).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Non-ff_live_ bearer → JWT delegation
// ---------------------------------------------------------------------------
describe('non-ff_live_ bearer → JWT delegation', () => {
  it('calls core authenticateToken and does NOT call verifyToken', async () => {
    const app = makeApp()
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer some.jwt.token')
    // authenticateToken mock calls next() so we get 200
    expect(res.status).toBe(200)
    expect(authenticateTokenMock).toHaveBeenCalledTimes(1)
    expect(verifyTokenMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// ff_live_ bearer — verifyToken failure states
// ---------------------------------------------------------------------------
describe('ff_live_ bearer — verifyToken → invalid', () => {
  it('returns 401 with "Invalid token"', async () => {
    verifyTokenMock.mockResolvedValue({ status: 'invalid' })
    const app = makeApp()
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ff_live_somepayload')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid token')
  })
})

describe('ff_live_ bearer — verifyToken → revoked', () => {
  it('returns 401 with "Token revoked"', async () => {
    verifyTokenMock.mockResolvedValue({ status: 'revoked' })
    const app = makeApp()
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ff_live_revoked123')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Token revoked')
  })
})

describe('ff_live_ bearer — verifyToken → expired', () => {
  it('returns 401 with "Token expired"', async () => {
    verifyTokenMock.mockResolvedValue({ status: 'expired' })
    const app = makeApp()
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ff_live_expired123')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Token expired')
  })
})

// ---------------------------------------------------------------------------
// PAT path — valid token → user lookup
// ---------------------------------------------------------------------------
describe('PAT path — valid token, user found', () => {
  it('sets req.user from DB row and req.apiToken from token', async () => {
    const token = makePATToken()
    verifyTokenMock.mockResolvedValue({ status: 'valid', token })
    mockDbUserFound({
      id: token.owner_id,
      email: 'alice@example.com',
      first_name: 'Alice',
      last_name: 'Smith',
      roles: ['user'],
    })

    const app = makeApp()
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ff_live_testpayload')

    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({
      id: token.owner_id,
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Smith',
      roles: ['user'],
    })
    expect(res.body.apiToken).toMatchObject({
      id: token.id,
      scopes: token.scopes,
      ownerType: 'user',
      ownerId: token.owner_id,
    })
  })

  it('calls updateLastUsed (fire-and-forget, not awaited before next())', async () => {
    const token = makePATToken()
    verifyTokenMock.mockResolvedValue({ status: 'valid', token })
    mockDbUserFound({
      id: token.owner_id,
      email: 'alice@example.com',
      first_name: 'Alice',
      last_name: 'Smith',
      roles: ['user'],
    })

    const app = makeApp()
    await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ff_live_testpayload')

    expect(updateLastUsedMock).toHaveBeenCalledWith(token.id)
  })
})

describe('PAT path — user not found in DB', () => {
  it('returns 401 when the user row is missing', async () => {
    const token = makePATToken()
    verifyTokenMock.mockResolvedValue({ status: 'valid', token })
    // DB returns null for the user lookup
    const chain: any = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(null),
    }
    dbMock.mockReturnValue(chain)

    const app = makeApp()
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ff_live_orphantoken')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/not found/i)
  })
})

// ---------------------------------------------------------------------------
// Service-token path — synthetic principal
// ---------------------------------------------------------------------------
describe('service-token path (owner_type === org)', () => {
  it('sets synthetic svc_token:<id> principal with roles [service]', async () => {
    const token = makeServiceToken()
    verifyTokenMock.mockResolvedValue({ status: 'valid', token })
    // DB should NOT be queried for a user row on the service-token path

    const app = makeApp()
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ff_live_servicepayload')

    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({
      id: `svc_token:${token.id}`,
      email: '',
      firstName: '',
      lastName: '',
      roles: ['service'],
    })
    expect(res.body.apiToken).toMatchObject({
      id: token.id,
      ownerType: 'org',
      ownerId: token.owner_id,
    })
    // DB must not have been called (no user lookup for service tokens)
    expect(dbMock).not.toHaveBeenCalled()
  })

  it('calls updateLastUsed for the service token', async () => {
    const token = makeServiceToken()
    verifyTokenMock.mockResolvedValue({ status: 'valid', token })

    const app = makeApp()
    await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ff_live_servicepayload')

    expect(updateLastUsedMock).toHaveBeenCalledWith(token.id)
  })
})

// ---------------------------------------------------------------------------
// Rate limiting — 11th failed attempt must return 429
// ---------------------------------------------------------------------------
describe('tokenAuthRateLimiter — 11th failed attempt returns 429', () => {
  it('allows 10 failures then blocks the 11th', async () => {
    const app = makeRateLimitApp()

    // Fire 10 requests — each gets 401 (and each counts toward the limit)
    for (let i = 0; i < 10; i++) {
      const r = await request(app)
        .get('/auth')
        .set('Authorization', `Bearer ff_live_badtoken${i}`)
      expect(r.status).toBe(401)
    }

    // 11th request should be 429
    const final = await request(app)
      .get('/auth')
      .set('Authorization', 'Bearer ff_live_badtoken_11th')
    expect(final.status).toBe(429)
  })
})
