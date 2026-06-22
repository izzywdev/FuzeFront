/**
 * Unit tests for API token routes and Permit-sync helpers.
 * DB, Permit, and services are mocked — no real Postgres/Permit required.
 *
 * authenticateFlexible is mocked to inject req.user (and req.apiToken where
 * needed), mirroring how organizations.invitations.test.ts mocks authenticateToken.
 *
 * user-sync is mocked for route tests (so Permit calls don't require real wiring).
 * The syncServiceTokenToPermit / removeServiceTokenFromPermit tests import and
 * test that module directly (permit + role-assignment are mocked for it).
 */
import request from 'supertest'
import express from 'express'

// ---------------------------------------------------------------------------
// Module mocks — MUST be before any imports that transitively require them
// ---------------------------------------------------------------------------

jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), {
    transaction: jest.fn(),
  }),
}))

jest.mock('../src/config/permit', () => ({
  __esModule: true,
  default: {
    api: {
      users: {
        sync: jest.fn().mockResolvedValue(undefined),
      },
    },
  },
}))

jest.mock('../src/utils/permit/role-assignment', () => ({
  assignRoleInPermit: jest.fn().mockResolvedValue(true),
  unassignRoleInPermit: jest.fn().mockResolvedValue(true),
  assignOrganizationRole: jest.fn().mockResolvedValue(true),
  updateOrganizationRole: jest.fn().mockResolvedValue(true),
  getUserRoleAssignments: jest.fn().mockResolvedValue([]),
  getTenantRoleAssignments: jest.fn().mockResolvedValue([]),
  userHasRole: jest.fn().mockResolvedValue(false),
}))

jest.mock('../src/utils/permit/permission-check', () => ({
  getUserPermissions: jest.fn().mockResolvedValue({}),
  checkPermission: jest.fn().mockResolvedValue(true),
  checkOrganizationPermission: jest.fn().mockResolvedValue(true),
  checkUserManagementPermission: jest.fn().mockResolvedValue(true),
  checkAppPermission: jest.fn().mockResolvedValue(true),
  checkOrganizationAccess: jest.fn().mockResolvedValue(true),
  requirePermission: jest.fn().mockReturnValue((_req: any, _res: any, next: any) => next()),
}))

jest.mock('../src/services/api-token', () => ({
  createToken: jest.fn(),
  listTokensForOwner: jest.fn(),
  getTokenById: jest.fn(),
  revokeToken: jest.fn(),
  mapScopesToPermitRole: jest.fn().mockReturnValue('viewer'),
}))

// Mock user-sync for route tests — so routes don't need a real Permit connection
jest.mock('../src/utils/permit/user-sync', () => ({
  syncServiceTokenToPermit: jest.fn().mockResolvedValue(true),
  removeServiceTokenFromPermit: jest.fn().mockResolvedValue(true),
  syncUserToPermit: jest.fn().mockResolvedValue(true),
  deleteUserFromPermit: jest.fn().mockResolvedValue(true),
  getUserFromPermit: jest.fn().mockResolvedValue(null),
  updateUserInPermit: jest.fn().mockResolvedValue(true),
}))

// Mock authenticateFlexible to inject req.user (and req.apiToken where needed)
jest.mock('../src/middleware/api-token-auth', () => ({
  tokenAuthRateLimiter: (_req: any, _res: any, next: any) => next(),
  authenticateFlexible: (req: any, _res: any, next: any) => {
    req.user = req.__testUser ?? {
      id: 'user-test-id',
      email: 'test@example.com',
      roles: ['user'],
    }
    if (req.__testApiToken !== undefined) {
      req.apiToken = req.__testApiToken
    }
    next()
  },
}))

// ---------------------------------------------------------------------------
// Imports after mocks are wired
// ---------------------------------------------------------------------------

import { db } from '../src/config/database'
import permit from '../src/config/permit'
import {
  createToken,
  listTokensForOwner,
  getTokenById,
  revokeToken,
  mapScopesToPermitRole,
} from '../src/services/api-token'
import {
  assignRoleInPermit,
  unassignRoleInPermit,
} from '../src/utils/permit/role-assignment'
import apiTokensRouter, { orgTokensRouter, requireTokenScope } from '../src/routes/api-tokens'
import {
  syncServiceTokenToPermit,
  removeServiceTokenFromPermit,
} from '../src/utils/permit/user-sync'

const dbMock = db as jest.MockedFunction<any>
const createTokenMock = createToken as jest.Mock
const listTokensMock = listTokensForOwner as jest.Mock
const getTokenByIdMock = getTokenById as jest.Mock
const revokeTokenMock = revokeToken as jest.Mock
const syncServiceTokenMock = syncServiceTokenToPermit as jest.Mock
const removeServiceTokenMock = removeServiceTokenFromPermit as jest.Mock
const assignRoleMock = assignRoleInPermit as jest.Mock
const unassignRoleMock = unassignRoleInPermit as jest.Mock
const permitSyncMock = (permit as any).api.users.sync as jest.Mock

// ---------------------------------------------------------------------------
// DB chain helper
// ---------------------------------------------------------------------------

function makeDbQuery(returnValue: any) {
  const chain: any = {
    where: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    whereNotNull: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(returnValue),
    insert: jest.fn().mockResolvedValue([1]),
    update: jest.fn().mockResolvedValue(1),
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockResolvedValue(returnValue !== null ? [returnValue] : []),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue(returnValue !== null ? [returnValue] : []),
  }
  return chain
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/tokens', apiTokensRouter)
  app.use('/api/organizations', orgTokensRouter)
  return app
}

const USER_ID = 'user-test-id'
const ORG_ID = 'org-test-id'
const TOKEN_ID = 'token-test-id'

const ADMIN_MEMBERSHIP = {
  id: 'mem-1',
  user_id: USER_ID,
  organization_id: ORG_ID,
  role: 'admin',
  status: 'active',
}

const SAMPLE_TOKEN_ROW = {
  id: TOKEN_ID,
  token_prefix: 'TESTPREFIX',
  owner_type: 'user',
  owner_id: USER_ID,
  name: 'My PAT',
  scopes: ['Organization:read'],
  expires_at: null,
  last_used_at: null,
  created_by: USER_ID,
  revoked_at: null,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
}

const SAMPLE_CREATE_RESULT = {
  id: TOKEN_ID,
  token: 'ff_live_TESTPREFIX.testbody',
  token_prefix: 'TESTPREFIX',
  name: 'My PAT',
  scopes: ['Organization:read'],
  expires_at: null,
  created_at: new Date('2026-01-01'),
}

// ============================================================================
// POST /api/tokens — create token
// ============================================================================

describe('POST /api/tokens', () => {
  let app: express.Application

  beforeEach(() => {
    jest.clearAllMocks()
    app = buildApp()
  })

  it('creates a PAT for own user ID → 201 with token field', async () => {
    createTokenMock.mockResolvedValue(SAMPLE_CREATE_RESULT)

    const res = await request(app)
      .post('/api/tokens')
      .send({
        name: 'My PAT',
        owner_type: 'user',
        owner_id: USER_ID,
        scopes: ['Organization:read'],
        expires_at: null,
      })

    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('token')
    expect(res.body.token).toBe('ff_live_TESTPREFIX.testbody')
    expect(res.body).toHaveProperty('id', TOKEN_ID)
    expect(res.body).not.toHaveProperty('token_hash')
    expect(createTokenMock).toHaveBeenCalledTimes(1)
  })

  it('rejects PAT creation for a different user → 403', async () => {
    const res = await request(app)
      .post('/api/tokens')
      .send({
        name: 'Other PAT',
        owner_type: 'user',
        owner_id: 'different-user-id',
        scopes: ['Organization:read'],
        expires_at: null,
      })

    expect(res.status).toBe(403)
    expect(createTokenMock).not.toHaveBeenCalled()
  })

  it('rejects unknown scope strings → 400', async () => {
    const res = await request(app)
      .post('/api/tokens')
      .send({
        name: 'My PAT',
        owner_type: 'user',
        owner_id: USER_ID,
        scopes: ['Organization:read', 'Unknown:action'],
        expires_at: null,
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Unknown scope/)
    expect(createTokenMock).not.toHaveBeenCalled()
  })

  it('rejects non-admin creating org token → 403', async () => {
    dbMock.mockImplementation((_table: string) => makeDbQuery(null))

    const res = await request(app)
      .post('/api/tokens')
      .send({
        name: 'Org Token',
        owner_type: 'org',
        owner_id: ORG_ID,
        scopes: ['Organization:read'],
        expires_at: null,
      })

    expect(res.status).toBe(403)
    expect(createTokenMock).not.toHaveBeenCalled()
  })

  it('allows org admin to create org token → 201 and syncServiceTokenToPermit called', async () => {
    dbMock.mockImplementation((_table: string) => makeDbQuery(ADMIN_MEMBERSHIP))
    createTokenMock.mockResolvedValue({ ...SAMPLE_CREATE_RESULT, id: 'org-token-id' })
    ;(mapScopesToPermitRole as jest.Mock).mockReturnValue('viewer')

    const res = await request(app)
      .post('/api/tokens')
      .send({
        name: 'Org Token',
        owner_type: 'org',
        owner_id: ORG_ID,
        scopes: ['Organization:read'],
        expires_at: null,
      })

    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('token')
    expect(createTokenMock).toHaveBeenCalledTimes(1)
    // syncServiceTokenToPermit is non-blocking; flush microtask queue deterministically
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(syncServiceTokenMock).toHaveBeenCalledWith('org-token-id', ORG_ID, 'viewer')
  })

  it('rejects empty name → 400', async () => {
    const res = await request(app)
      .post('/api/tokens')
      .send({ name: '', owner_type: 'user', owner_id: USER_ID, scopes: [] })
    expect(res.status).toBe(400)
  })

  it('rejects invalid owner_type → 400', async () => {
    const res = await request(app)
      .post('/api/tokens')
      .send({ name: 'T', owner_type: 'invalid', owner_id: USER_ID, scopes: [] })
    expect(res.status).toBe(400)
  })

  it('rejects invalid expires_at → 400', async () => {
    const res = await request(app)
      .post('/api/tokens')
      .send({
        name: 'T',
        owner_type: 'user',
        owner_id: USER_ID,
        scopes: [],
        expires_at: 'notadate',
      })
    expect(res.status).toBe(400)
  })
})

// ============================================================================
// GET /api/tokens — list caller's PATs
// ============================================================================

describe('GET /api/tokens', () => {
  let app: express.Application

  beforeEach(() => {
    jest.clearAllMocks()
    app = buildApp()
  })

  it('returns list without token or token_hash fields', async () => {
    listTokensMock.mockResolvedValue([
      { ...SAMPLE_TOKEN_ROW },
      { ...SAMPLE_TOKEN_ROW, id: 'token-2', name: 'Second PAT' },
    ])

    const res = await request(app).get('/api/tokens')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('tokens')
    expect(Array.isArray(res.body.tokens)).toBe(true)
    expect(res.body.tokens).toHaveLength(2)
    for (const t of res.body.tokens) {
      expect(t).not.toHaveProperty('token')
      expect(t).not.toHaveProperty('token_hash')
    }
    expect(listTokensMock).toHaveBeenCalledWith('user', USER_ID)
  })
})

// ============================================================================
// GET /api/tokens/:tokenId — metadata
// ============================================================================

describe('GET /api/tokens/:tokenId', () => {
  let app: express.Application

  beforeEach(() => {
    jest.clearAllMocks()
    app = buildApp()
  })

  it('returns 404 when token does not exist', async () => {
    getTokenByIdMock.mockResolvedValue(null)
    const res = await request(app).get('/api/tokens/nonexistent')
    expect(res.status).toBe(404)
  })

  it('returns 200 with metadata for own token (no token/token_hash)', async () => {
    getTokenByIdMock.mockResolvedValue({ ...SAMPLE_TOKEN_ROW })
    const res = await request(app).get(`/api/tokens/${TOKEN_ID}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('id', TOKEN_ID)
    expect(res.body).not.toHaveProperty('token')
    expect(res.body).not.toHaveProperty('token_hash')
  })

  it('returns 403 for another user\'s PAT (ownership enforced)', async () => {
    getTokenByIdMock.mockResolvedValue({ ...SAMPLE_TOKEN_ROW, owner_id: 'other-user-id' })
    const res = await request(app).get(`/api/tokens/${TOKEN_ID}`)
    expect(res.status).toBe(403)
  })

  it('returns 403 for org token when caller is not admin', async () => {
    getTokenByIdMock.mockResolvedValue({ ...SAMPLE_TOKEN_ROW, owner_type: 'org', owner_id: ORG_ID })
    dbMock.mockImplementation((_table: string) => makeDbQuery(null))
    const res = await request(app).get(`/api/tokens/${TOKEN_ID}`)
    expect(res.status).toBe(403)
  })

  it('returns 200 for org token when caller is admin', async () => {
    getTokenByIdMock.mockResolvedValue({ ...SAMPLE_TOKEN_ROW, owner_type: 'org', owner_id: ORG_ID })
    dbMock.mockImplementation((_table: string) => makeDbQuery(ADMIN_MEMBERSHIP))
    const res = await request(app).get(`/api/tokens/${TOKEN_ID}`)
    expect(res.status).toBe(200)
  })
})

// ============================================================================
// DELETE /api/tokens/:tokenId — revoke
// ============================================================================

describe('DELETE /api/tokens/:tokenId', () => {
  let app: express.Application

  beforeEach(() => {
    jest.clearAllMocks()
    app = buildApp()
  })

  it('returns 404 when token does not exist', async () => {
    getTokenByIdMock.mockResolvedValue(null)
    const res = await request(app).delete('/api/tokens/nonexistent')
    expect(res.status).toBe(404)
  })

  it('revokes own PAT → 200, revokeToken called', async () => {
    getTokenByIdMock.mockResolvedValue({ ...SAMPLE_TOKEN_ROW })
    revokeTokenMock.mockResolvedValue(true)

    const res = await request(app).delete(`/api/tokens/${TOKEN_ID}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('message', 'Token revoked')
    expect(revokeTokenMock).toHaveBeenCalledWith(TOKEN_ID)
  })

  it('returns 403 for non-owner PAT revoke attempt', async () => {
    getTokenByIdMock.mockResolvedValue({ ...SAMPLE_TOKEN_ROW, owner_id: 'other-user' })
    const res = await request(app).delete(`/api/tokens/${TOKEN_ID}`)
    expect(res.status).toBe(403)
    expect(revokeTokenMock).not.toHaveBeenCalled()
  })

  it('revokes org token → 200, revokeToken called, removeServiceTokenFromPermit called', async () => {
    getTokenByIdMock.mockResolvedValue({
      ...SAMPLE_TOKEN_ROW,
      owner_type: 'org',
      owner_id: ORG_ID,
    })
    revokeTokenMock.mockResolvedValue(true)
    dbMock.mockImplementation((_table: string) => makeDbQuery(ADMIN_MEMBERSHIP))
    ;(mapScopesToPermitRole as jest.Mock).mockReturnValue('viewer')

    const res = await request(app).delete(`/api/tokens/${TOKEN_ID}`)
    expect(res.status).toBe(200)
    expect(revokeTokenMock).toHaveBeenCalledWith(TOKEN_ID)
    // removeServiceTokenFromPermit is non-blocking; flush microtask queue deterministically
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(removeServiceTokenMock).toHaveBeenCalledWith(TOKEN_ID, ORG_ID, 'viewer')
  })

  it('returns 403 for non-admin org token revoke', async () => {
    getTokenByIdMock.mockResolvedValue({
      ...SAMPLE_TOKEN_ROW,
      owner_type: 'org',
      owner_id: ORG_ID,
    })
    dbMock.mockImplementation((_table: string) => makeDbQuery(null))
    const res = await request(app).delete(`/api/tokens/${TOKEN_ID}`)
    expect(res.status).toBe(403)
    expect(revokeTokenMock).not.toHaveBeenCalled()
  })
})

// ============================================================================
// GET /api/organizations/:orgId/tokens — org tokens sub-route
// ============================================================================

describe('GET /api/organizations/:orgId/tokens', () => {
  let app: express.Application

  beforeEach(() => {
    jest.clearAllMocks()
    app = buildApp()
  })

  it('returns 403 when caller is not org admin', async () => {
    dbMock.mockImplementation((_table: string) => makeDbQuery(null))
    const res = await request(app).get(`/api/organizations/${ORG_ID}/tokens`)
    expect(res.status).toBe(403)
  })

  it('returns 200 with org tokens (no token/token_hash) when caller is admin', async () => {
    dbMock.mockImplementation((_table: string) => makeDbQuery(ADMIN_MEMBERSHIP))
    listTokensMock.mockResolvedValue([
      { ...SAMPLE_TOKEN_ROW, owner_type: 'org', owner_id: ORG_ID, id: 'org-tok-1' },
    ])

    const res = await request(app).get(`/api/organizations/${ORG_ID}/tokens`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('tokens')
    expect(res.body.tokens[0]).not.toHaveProperty('token')
    expect(res.body.tokens[0]).not.toHaveProperty('token_hash')
    expect(listTokensMock).toHaveBeenCalledWith('org', ORG_ID)
  })
})

// ============================================================================
// requireTokenScope middleware
// ============================================================================

describe('requireTokenScope middleware', () => {
  function runMiddleware(scope: string, apiToken: any, next: jest.Mock) {
    const middleware = requireTokenScope(scope)
    const req: any = { apiToken }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }
    middleware(req, res, next)
    return res
  }

  it('calls next() when apiToken is not set (JWT request)', () => {
    const next = jest.fn()
    runMiddleware('Organization:read', undefined, next)
    expect(next).toHaveBeenCalled()
  })

  it('calls next() when apiToken has the required scope', () => {
    const next = jest.fn()
    runMiddleware('Organization:read', { scopes: ['Organization:read', 'App:read'] }, next)
    expect(next).toHaveBeenCalled()
  })

  it('returns 403 when apiToken is missing the required scope', () => {
    const next = jest.fn()
    const res = runMiddleware('Organization:manage', { scopes: ['Organization:read'] }, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Scope not granted by token' })
  })
})

// ============================================================================
// Permit-sync helpers: syncServiceTokenToPermit / removeServiceTokenFromPermit
// These tests bypass the route mock and test the real user-sync functions
// (which use the mocked permit + role-assignment modules).
// ============================================================================

// NOTE: We import user-sync functions above — but they are ALSO mocked above.
// To test the real implementation, we need to jest.unmock and re-require.
// Instead, we test the helpers in a separate describe that re-imports directly.

describe('syncServiceTokenToPermit (real implementation, mocked permit+role-assignment)', () => {
  // Re-require the real function (unmock the user-sync module for this scope)
  // Jest does not support per-describe unmocking, so we use jest.isolateModules.
  let realSyncServiceToken: (tokenId: string, orgId: string, role: 'viewer' | 'editor' | 'admin') => Promise<boolean>
  let realRemoveServiceToken: (tokenId: string, orgId: string, role: 'viewer' | 'editor' | 'admin') => Promise<boolean>

  beforeAll(async () => {
    // Unmock user-sync, re-require it; permit + role-assignment remain mocked
    jest.unmock('../src/utils/permit/user-sync')
    await jest.isolateModulesAsync(async () => {
      const mod = await import('../src/utils/permit/user-sync')
      realSyncServiceToken = mod.syncServiceTokenToPermit
      realRemoveServiceToken = mod.removeServiceTokenFromPermit
    })
  })

  beforeEach(() => {
    jest.clearAllMocks()
    permitSyncMock.mockResolvedValue(undefined)
    assignRoleMock.mockResolvedValue(true)
    unassignRoleMock.mockResolvedValue(true)
  })

  it('syncs user to Permit and assigns role, returns true on success', async () => {
    const result = await realSyncServiceToken('tok-1', 'org-1', 'editor')

    expect(result).toBe(true)
    expect(permitSyncMock).toHaveBeenCalledWith({
      key: 'svc_token:tok-1',
      attributes: { is_service_token: true, org_id: 'org-1' },
    })
    expect(assignRoleMock).toHaveBeenCalledWith({
      user: 'svc_token:tok-1',
      role: 'editor',
      tenant: 'org-1',
    })
  })

  it('returns false and swallows error on Permit sync failure', async () => {
    permitSyncMock.mockRejectedValue(new Error('Permit down'))
    const result = await realSyncServiceToken('tok-1', 'org-1', 'viewer')
    expect(result).toBe(false)
  })

  it('unassigns role and returns true on success', async () => {
    const result = await realRemoveServiceToken('tok-1', 'org-1', 'admin')

    expect(result).toBe(true)
    expect(unassignRoleMock).toHaveBeenCalledWith({
      user: 'svc_token:tok-1',
      role: 'admin',
      tenant: 'org-1',
    })
  })

  it('returns false and swallows error on unassign failure', async () => {
    unassignRoleMock.mockRejectedValue(new Error('Permit unavailable'))
    const result = await realRemoveServiceToken('tok-1', 'org-1', 'viewer')
    expect(result).toBe(false)
  })
})
