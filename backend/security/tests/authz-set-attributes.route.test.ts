/**
 * Route tests for `PATCH /api/v1/security/authz/subjects/:subjectType/:subjectKey/attributes`
 * — the subject ABAC attribute-write (F2 implementation of the F1-frozen
 * contract, `packages/security/openapi.yaml`'s `setSubjectAttributes`).
 *
 * The `AuthorizationProvider` is mocked so this file proves ROUTE behavior —
 * validation, auth gating, status-code/error-envelope mapping — independent
 * of the concrete Permit implementation (covered separately by
 * `authz-set-attributes.provider.test.ts`).
 */
process.env.NODE_ENV = 'test'
process.env.PERMIT_API_KEY = process.env.PERMIT_API_KEY || 'ci-no-real-permit-calls'

import express from 'express'
import request from 'supertest'
import authzRoutes, { AUTHZ_ADMIN_SCOPE } from '../src/routes/authz'
import { setIdentityProvider } from '../src/providers/factory'
import { setAuthorizationProvider } from '../src/providers/authzFactory'
import { introspectMachineToken } from '../src/services/machine-identity'

jest.mock('../src/services/machine-identity', () => ({
  introspectMachineToken: jest.fn(),
}))

const mockIntrospect = introspectMachineToken as jest.MockedFunction<typeof introspectMachineToken>

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', authzRoutes)
  return app
}

const identityProvider = {
  getUserInfo: jest.fn().mockResolvedValue({ user: { id: 'user-1' } }),
}

const authorizationProvider = {
  check: jest.fn(),
  bulkCheck: jest.fn(),
  getPermissions: jest.fn(),
  grant: jest.fn(),
  revoke: jest.fn(),
  listGrants: jest.fn(),
  listTenants: jest.fn(),
  createTenant: jest.fn(),
  getTenant: jest.fn(),
  listMembers: jest.fn(),
  addMember: jest.fn(),
  removeMember: jest.fn(),
  assignRoles: jest.fn(),
  listRoles: jest.fn(),
  setAttributes: jest.fn(),
}

beforeEach(() => {
  jest.clearAllMocks()
  setIdentityProvider(identityProvider as any)
  setAuthorizationProvider(authorizationProvider as any)
  identityProvider.getUserInfo.mockResolvedValue({ user: { id: 'user-1' } })
})

afterEach(() => {
  setIdentityProvider(null)
  setAuthorizationProvider(null)
})

const PATH = '/api/v1/security/authz/subjects/tenant/org_acme/attributes'

describe('PATCH /api/v1/security/authz/subjects/:subjectType/:subjectKey/attributes', () => {
  it('returns 200 and echoes the merged attributes for an authorized human caller', async () => {
    authorizationProvider.setAttributes.mockResolvedValue({
      subject: { type: 'tenant', key: 'org_acme' },
      attributes: { plan_tier: 'pro', seat_limit: 25 },
      updatedAt: 1_700_000_000_000,
    })

    const response = await request(buildApp())
      .patch(PATH)
      .set('Authorization', 'Bearer valid-token')
      .send({ attributes: { plan_tier: 'pro', seat_limit: 25 } })
      .expect(200)

    expect(response.type).toMatch(/json/)
    expect(response.body).toEqual({
      subject: { type: 'tenant', key: 'org_acme' },
      attributes: { plan_tier: 'pro', seat_limit: 25 },
      updatedAt: 1_700_000_000_000,
    })
    expect(authorizationProvider.setAttributes).toHaveBeenCalledWith({
      subject: { type: 'tenant', key: 'org_acme' },
      attributes: { plan_tier: 'pro', seat_limit: 25 },
    })
  })

  it('the numeric attribute (seat_limit) round-trips as a NUMBER in the JSON response, never a string', async () => {
    authorizationProvider.setAttributes.mockResolvedValue({
      subject: { type: 'tenant', key: 'org_acme' },
      attributes: { seat_limit: 25 },
      updatedAt: 1_700_000_000_000,
    })

    const response = await request(buildApp())
      .patch(PATH)
      .set('Authorization', 'Bearer valid-token')
      .send({ attributes: { seat_limit: 25 } })
      .expect(200)

    expect(response.body.attributes.seat_limit).toBe(25)
    expect(typeof response.body.attributes.seat_limit).toBe('number')
  })

  it('a boolean attribute round-trips unchanged', async () => {
    authorizationProvider.setAttributes.mockResolvedValue({
      subject: { type: 'user', key: 'usr_1' },
      attributes: { beta_enrolled: true },
      updatedAt: 1_700_000_000_000,
    })

    const response = await request(buildApp())
      .patch('/api/v1/security/authz/subjects/user/usr_1/attributes')
      .set('Authorization', 'Bearer valid-token')
      .send({ attributes: { beta_enrolled: true } })
      .expect(200)

    expect(response.body.attributes.beta_enrolled).toBe(true)
  })

  it('returns 401 application/json when unauthenticated', async () => {
    const response = await request(buildApp())
      .patch(PATH)
      .send({ attributes: { plan_tier: 'pro' } })
      .expect(401)

    expect(response.type).toMatch(/json/)
    expect(response.body.code).toBe('AUTH_REQUIRED')
    expect(authorizationProvider.setAttributes).not.toHaveBeenCalled()
  })

  it("returns 400 MALFORMED for an unrecognized subjectType (not 'user' or 'tenant')", async () => {
    const response = await request(buildApp())
      .patch('/api/v1/security/authz/subjects/robot/org_acme/attributes')
      .set('Authorization', 'Bearer valid-token')
      .send({ attributes: { plan_tier: 'pro' } })
      .expect(400)

    expect(response.body.code).toBe('MALFORMED')
    expect(authorizationProvider.setAttributes).not.toHaveBeenCalled()
  })

  it('returns 400 MALFORMED when attributes is missing', async () => {
    const response = await request(buildApp())
      .patch(PATH)
      .set('Authorization', 'Bearer valid-token')
      .send({})
      .expect(400)

    expect(response.body.code).toBe('MALFORMED')
  })

  it('returns 400 MALFORMED when attributes is empty', async () => {
    const response = await request(buildApp())
      .patch(PATH)
      .set('Authorization', 'Bearer valid-token')
      .send({ attributes: {} })
      .expect(400)

    expect(response.body.code).toBe('MALFORMED')
  })

  it('returns 400 MALFORMED when an attribute value is a nested object (non-scalar)', async () => {
    const response = await request(buildApp())
      .patch(PATH)
      .set('Authorization', 'Bearer valid-token')
      .send({ attributes: { nested: { a: 1 } } })
      .expect(400)

    expect(response.body.code).toBe('MALFORMED')
    expect(authorizationProvider.setAttributes).not.toHaveBeenCalled()
  })

  it('returns 400 MALFORMED when an attribute value is an array (non-scalar)', async () => {
    const response = await request(buildApp())
      .patch(PATH)
      .set('Authorization', 'Bearer valid-token')
      .send({ attributes: { tags: ['a', 'b'] } })
      .expect(400)

    expect(response.body.code).toBe('MALFORMED')
  })

  it('MERGES only the named keys — the request body is forwarded verbatim, never widened/replaced', async () => {
    authorizationProvider.setAttributes.mockResolvedValue({
      subject: { type: 'tenant', key: 'org_acme' },
      attributes: { plan_status: 'active' },
      updatedAt: 1_700_000_000_000,
    })

    await request(buildApp())
      .patch(PATH)
      .set('Authorization', 'Bearer valid-token')
      .send({ attributes: { plan_status: 'active' } })
      .expect(200)

    expect(authorizationProvider.setAttributes).toHaveBeenCalledWith({
      subject: { type: 'tenant', key: 'org_acme' },
      attributes: { plan_status: 'active' },
    })
  })

  it('returns 502 PROVIDER_UNAVAILABLE — never a fail-open 200 or a bare 500 — when the provider throws', async () => {
    authorizationProvider.setAttributes.mockRejectedValueOnce(new Error('permit unreachable'))

    const response = await request(buildApp())
      .patch(PATH)
      .set('Authorization', 'Bearer valid-token')
      .send({ attributes: { plan_tier: 'pro' } })
      .expect(502)

    expect(response.type).toMatch(/json/)
    expect(response.body.code).toBe('PROVIDER_UNAVAILABLE')
  })
})

describe('PATCH .../attributes — machine callers require authz:admin (same gate as grant/revoke)', () => {
  const CALLER_TOKEN = 'machine-token-fuzecall-backend'
  const OPERATOR_TOKEN = 'machine-token-operator'

  beforeEach(() => {
    identityProvider.getUserInfo.mockRejectedValue(new Error('not a session token'))
    mockIntrospect.mockImplementation(async (token: string) => {
      if (token === CALLER_TOKEN) {
        return { active: true, client_id: 'fuzecall-backend', scope: 's2s:fuzecall' }
      }
      if (token === OPERATOR_TOKEN) {
        return { active: true, client_id: 'authz-operator', scope: `s2s:platform ${AUTHZ_ADMIN_SCOPE}` }
      }
      return { active: false }
    })
  })

  it('is FORBIDDEN for a machine caller without the authz:admin scope', async () => {
    const response = await request(buildApp())
      .patch(PATH)
      .set('Authorization', `Bearer ${CALLER_TOKEN}`)
      .send({ attributes: { plan_tier: 'pro' } })
      .expect(403)

    expect(response.body.code).toBe('FORBIDDEN')
    expect(authorizationProvider.setAttributes).not.toHaveBeenCalled()
  })

  it('is ALLOWED for a machine caller holding the authz:admin scope', async () => {
    authorizationProvider.setAttributes.mockResolvedValue({
      subject: { type: 'tenant', key: 'org_acme' },
      attributes: { plan_tier: 'pro' },
      updatedAt: 1_700_000_000_000,
    })

    const response = await request(buildApp())
      .patch(PATH)
      .set('Authorization', `Bearer ${OPERATOR_TOKEN}`)
      .send({ attributes: { plan_tier: 'pro' } })
      .expect(200)

    expect(response.body.attributes).toEqual({ plan_tier: 'pro' })
  })
})
