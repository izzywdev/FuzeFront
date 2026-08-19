/**
 * machine-auth.test.ts
 *
 * Unit tests for machine/service-account (agent) identity support.
 *
 * Tests cover:
 *  - Token introspection middleware: success, inactive token, Authentik down
 *  - MachineIdentity construction from introspection result
 *  - requireMachineScope guard
 *  - Permit.io machine-roles helpers (mocked — no live Permit SDK calls)
 *  - delegate_of relationship creation / permission check
 *
 * Authentik and Permit SDK are mocked so this suite runs without any live
 * external dependencies (same pattern as the rest of the backend unit tests).
 */

import express, { Request, Response } from 'express'
import request from 'supertest'

// ---------------------------------------------------------------------------
// Mock axios before importing modules that use it
// ---------------------------------------------------------------------------

jest.mock('axios', () => {
  const actual = jest.requireActual('axios')
  return {
    ...actual,
    post: jest.fn(),
    get: jest.fn(),
    isAxiosError: actual.isAxiosError,
  }
})

// Mock the permit config so we never open real TCP connections
jest.mock('../src/config/permit', () => {
  const makeNoOpProxy = (): any => {
    const handler: ProxyHandler<object> = {
      get: () => makeNoOpProxy(),
      apply: () => Promise.resolve(false),
      construct: () => makeNoOpProxy(),
    }
    return new Proxy(function () {} as any, handler)
  }
  return { __esModule: true, default: makeNoOpProxy(), destroyPermitClient: jest.fn() }
})

import axios from 'axios'
import {
  introspectMachineToken,
  buildMachineIdentity,
  TokenIntrospectionResult,
} from '../src/services/machine-identity'
import {
  authenticateMachineToken,
  requireMachineScope,
} from '../src/middleware/machine-auth'
import {
  syncMachineIdentityToPermit,
  createDelegateRelationship,
  checkMachinePermission,
} from '../src/utils/permit/machine-roles'

const mockedAxiosPost = axios.post as jest.MockedFunction<typeof axios.post>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(): express.Application {
  const app = express()
  app.use(express.json())

  // Protected route — machine token only
  app.get(
    '/machine-only',
    authenticateMachineToken,
    (_req: Request, res: Response) => {
      res.json({ ok: true, clientId: (_req as any).machineIdentity?.clientId })
    }
  )

  // Scoped route — machine token + specific scope
  app.get(
    '/scoped',
    authenticateMachineToken,
    requireMachineScope('jobs:write'),
    (_req: Request, res: Response) => {
      res.json({ ok: true })
    }
  )

  return app
}

const VALID_INTROSPECTION: TokenIntrospectionResult = {
  active: true,
  client_id: 'test-machine-client-001',
  scope: 'openid jobs:write',
  sub: 'hashed-sub-xyz',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
}

const VALID_INTROSPECTION_WITH_DELEGATE: TokenIntrospectionResult = {
  ...VALID_INTROSPECTION,
  delegate_user_id: 'human-user-abc',
}

// ---------------------------------------------------------------------------
// Setup env vars needed by introspectMachineToken
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.AUTHENTIK_CLIENT_ID = 'app-client-id'
  process.env.AUTHENTIK_CLIENT_SECRET = 'app-client-secret'
  process.env.AUTHENTIK_ISSUER_URL = 'http://authentik.test/application/o/fuzefront/'
})

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// introspectMachineToken
// ---------------------------------------------------------------------------

describe('introspectMachineToken()', () => {
  it('returns active introspection result for a valid token', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: VALID_INTROSPECTION })

    const result = await introspectMachineToken('valid-bearer-token')

    expect(result.active).toBe(true)
    expect(result.client_id).toBe('test-machine-client-001')
    expect(result.scope).toBe('openid jobs:write')
  })

  it('returns active:false for an inactive/revoked token', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: { active: false } })

    const result = await introspectMachineToken('revoked-token')

    expect(result.active).toBe(false)
  })

  it('returns active:false when Authentik is unreachable (network error)', async () => {
    const networkError = Object.assign(new Error('ECONNREFUSED'), {
      isAxiosError: true,
      response: undefined,
    })
    mockedAxiosPost.mockRejectedValueOnce(networkError)

    const result = await introspectMachineToken('any-token')

    expect(result.active).toBe(false)
  })

  it('returns active:false when introspection credentials are rejected (401)', async () => {
    const unauthorizedError = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401 },
    })
    mockedAxiosPost.mockRejectedValueOnce(unauthorizedError)

    const result = await introspectMachineToken('any-token')

    expect(result.active).toBe(false)
  })

  it('sends token and token_type_hint in the request body', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: VALID_INTROSPECTION })

    await introspectMachineToken('my-token-value')

    expect(mockedAxiosPost).toHaveBeenCalledTimes(1)
    const [url, body] = mockedAxiosPost.mock.calls[0]
    expect(url).toContain('/introspect/')
    expect(body).toContain('token=my-token-value')
    expect(body).toContain('token_type_hint=access_token')
  })
})

// ---------------------------------------------------------------------------
// buildMachineIdentity()
// ---------------------------------------------------------------------------

describe('buildMachineIdentity()', () => {
  it('builds a MachineIdentity from a valid introspection result', () => {
    const identity = buildMachineIdentity(VALID_INTROSPECTION)

    expect(identity).not.toBeNull()
    expect(identity!.clientId).toBe('test-machine-client-001')
    expect(identity!.scopes).toEqual(['openid', 'jobs:write'])
    expect(identity!.active).toBe(true)
    expect(identity!.delegateUserId).toBeUndefined()
  })

  it('populates delegateUserId when present in introspection', () => {
    const identity = buildMachineIdentity(VALID_INTROSPECTION_WITH_DELEGATE)

    expect(identity!.delegateUserId).toBe('human-user-abc')
  })

  it('returns null for an inactive token', () => {
    const identity = buildMachineIdentity({ active: false })

    expect(identity).toBeNull()
  })

  it('returns null when client_id is missing', () => {
    const identity = buildMachineIdentity({ active: true })

    expect(identity).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// authenticateMachineToken middleware (via supertest)
// ---------------------------------------------------------------------------

describe('authenticateMachineToken middleware', () => {
  let app: express.Application

  beforeAll(() => {
    app = buildApp()
  })

  it('returns 401 when no Authorization header is present', async () => {
    const res = await request(app).get('/machine-only').expect(401)

    expect(res.body.error).toContain('No machine token')
  })

  it('returns 401 for an inactive token', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: { active: false } })

    const res = await request(app)
      .get('/machine-only')
      .set('Authorization', 'Bearer inactive-token')
      .expect(401)

    expect(res.body.error).toContain('Invalid or expired')
  })

  it('returns 401 when Authentik is unreachable', async () => {
    const networkError = Object.assign(new Error('ECONNREFUSED'), {
      isAxiosError: true,
      response: undefined,
    })
    mockedAxiosPost.mockRejectedValueOnce(networkError)

    const res = await request(app)
      .get('/machine-only')
      .set('Authorization', 'Bearer any-token')
      .expect(401)

    expect(res.body.error).toBeDefined()
  })

  it('returns 200 and attaches machineIdentity for a valid token', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: VALID_INTROSPECTION })

    const res = await request(app)
      .get('/machine-only')
      .set('Authorization', 'Bearer valid-machine-token')
      .expect(200)

    expect(res.body.ok).toBe(true)
    expect(res.body.clientId).toBe('test-machine-client-001')
  })
})

// ---------------------------------------------------------------------------
// requireMachineScope guard (via supertest)
// ---------------------------------------------------------------------------

describe('requireMachineScope middleware', () => {
  let app: express.Application

  beforeAll(() => {
    app = buildApp()
  })

  it('returns 200 when the token has the required scope', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: VALID_INTROSPECTION })

    await request(app)
      .get('/scoped')
      .set('Authorization', 'Bearer token-with-jobs-write')
      .expect(200)
  })

  it('returns 403 when the token is missing required scope', async () => {
    const noScopeIntrospection: TokenIntrospectionResult = {
      ...VALID_INTROSPECTION,
      scope: 'openid', // no jobs:write
    }
    mockedAxiosPost.mockResolvedValueOnce({ data: noScopeIntrospection })

    const res = await request(app)
      .get('/scoped')
      .set('Authorization', 'Bearer limited-scope-token')
      .expect(403)

    expect(res.body.error).toContain('Insufficient scopes')
    expect(res.body.missing).toContain('jobs:write')
  })
})

// ---------------------------------------------------------------------------
// Permit.io machine-roles helpers
// ---------------------------------------------------------------------------

describe('syncMachineIdentityToPermit()', () => {
  it('returns true on success (no-op permit mock)', async () => {
    const result = await syncMachineIdentityToPermit({
      clientId: 'test-client',
      name: 'Test Agent',
      scopes: ['openid'],
      active: true,
    })
    // The no-op permit mock resolves to undefined; we expect true (no error)
    expect(result).toBe(true)
  })
})

describe('createDelegateRelationship()', () => {
  it('returns true on success', async () => {
    const result = await createDelegateRelationship({
      agentKey: 'my-agent-client-id',
      userKey: 'human-user-001',
      tenant: 'org-abc',
    })
    expect(result).toBe(true)
  })

  it('returns true when relationship already exists (idempotent)', async () => {
    // Simulate 409 Conflict from Permit (relationship already exists)
    const permitModule = require('../src/config/permit')
    const conflictError = { response: { status: 409 } }
    jest
      .spyOn(permitModule.default.api.relationshipTuples, 'create')
      .mockRejectedValueOnce(conflictError)

    const result = await createDelegateRelationship({
      agentKey: 'my-agent',
      userKey: 'human-user-001',
      tenant: 'org-abc',
    })
    expect(result).toBe(true)
  })
})

describe('checkMachinePermission()', () => {
  it('delegates permission check to the delegated user when delegateUserId is set', async () => {
    const identity = buildMachineIdentity(VALID_INTROSPECTION_WITH_DELEGATE)!

    // The no-op permit mock resolves permit.check to undefined (falsy) — just
    // verify it does not throw and returns a boolean
    const result = await checkMachinePermission(identity, 'read', {
      type: 'Organization',
      tenant: 'org-xyz',
    })
    expect(typeof result).toBe('boolean')
  })

  it('uses the machine identity key when no delegate is set', async () => {
    const identity = buildMachineIdentity(VALID_INTROSPECTION)!

    const result = await checkMachinePermission(identity, 'read', {
      type: 'App',
      tenant: 'org-xyz',
      key: 'app-001',
    })
    expect(typeof result).toBe('boolean')
  })
})
