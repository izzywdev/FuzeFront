/**
 * /internal/membership-sync + /internal/membership-unsync — the reconcile
 * target for identity.membership.added/removed (consumed by provisioning-service).
 *
 * Collaborators of the router are mocked; only the HTTP contract (auth, body
 * validation, mapping to assign/unassignOrganizationRole, error semantics) is
 * under test. No real Postgres / Permit.
 */
import request from 'supertest'
import express from 'express'

const mockAssign = jest.fn()
const mockUnassign = jest.fn()
const mockEnsureDeveloperMembership = jest.fn()
const mockIsDevportalEnabled = jest.fn()

jest.mock('../src/utils/permit/role-assignment', () => ({
  assignOrganizationRole: (...a: any[]) => mockAssign(...a),
  unassignOrganizationRole: (...a: any[]) => mockUnassign(...a),
}))
// Unrelated imports of the router module — stubbed so no DB/Permit/OIDC loads.
jest.mock('../src/config/database', () => ({ db: jest.fn() }))
jest.mock('../src/services/organizationProvisioning', () => ({
  runInternalProvision: jest.fn(),
  deprovisionOrganization: jest.fn(),
  ensureDeveloperMembership: (...args: unknown[]) => mockEnsureDeveloperMembership(...args),
}))
jest.mock('../src/services/userLifecycle', () => ({
  syncUserProfile: jest.fn(),
  deprovisionUser: jest.fn(),
}))
jest.mock('../src/services/oidc', () => ({ syncUserToDatabase: jest.fn() }))
jest.mock('../src/utils/devportalFlag', () => ({
  isDevportalEnabled: (...args: unknown[]) => mockIsDevportalEnabled(...args),
}))

import internalRoutes from '../src/routes/internal'

const SECRET = 'test-internal-secret'
const ORG = '33333333-3333-3333-3333-333333333333'
const USER = '11111111-1111-1111-1111-111111111111'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/internal', internalRoutes)
  return app
}

describe.each([
  ['membership-sync', mockAssign, mockUnassign],
  ['membership-unsync', mockUnassign, mockAssign],
] as const)('POST /internal/%s', (path, target, other) => {
  const url = `/internal/${path}`
  const post = (body: unknown, secret: string | null = SECRET) => {
    const r = request(makeApp()).post(url)
    if (secret !== null) r.set('x-internal-secret', secret)
    return r.send(body as object)
  }

  beforeEach(() => {
    process.env.INTERNAL_PROVISION_SECRET = SECRET
    mockAssign.mockReset().mockResolvedValue(true)
    mockUnassign.mockReset().mockResolvedValue(true)
  })

  it('calls only its own role-assignment function with (userId, orgId, role) and returns 200', async () => {
    const res = await post({ organizationId: ORG, userId: USER, role: 'member' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, organizationId: ORG, userId: USER, role: 'member' })
    expect(target).toHaveBeenCalledTimes(1)
    expect(target).toHaveBeenCalledWith(USER, ORG, 'member')
    expect(other).not.toHaveBeenCalled()
  })

  it.each(['owner', 'admin', 'member', 'viewer', 'developer'])('accepts role %s', async role => {
    const res = await post({ organizationId: ORG, userId: USER, role })
    expect(res.status).toBe(200)
    expect(target).toHaveBeenCalledWith(USER, ORG, role)
  })

  it('rejects an unknown role with 400 and does not touch Permit', async () => {
    const res = await post({ organizationId: ORG, userId: USER, role: 'superuser' })
    expect(res.status).toBe(400)
    expect(target).not.toHaveBeenCalled()
  })

  it.each([
    ['missing organizationId', { userId: USER, role: 'member' }],
    ['missing userId', { organizationId: ORG, role: 'member' }],
    ['missing role', { organizationId: ORG, userId: USER }],
    ['non-uuid userId', { organizationId: ORG, userId: 'nope', role: 'member' }],
    ['unknown extra key', { organizationId: ORG, userId: USER, role: 'member', id: 'x' }],
  ])('rejects %s with 400', async (_n, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(target).not.toHaveBeenCalled()
  })

  it('returns 401 for a bad secret and does not touch Permit', async () => {
    const res = await post({ organizationId: ORG, userId: USER, role: 'member' }, 'wrong')
    expect(res.status).toBe(401)
    expect(target).not.toHaveBeenCalled()
  })

  it('returns 401 when no secret header is sent', async () => {
    const res = await post({ organizationId: ORG, userId: USER, role: 'member' }, null)
    expect(res.status).toBe(401)
  })

  it('fails closed (401) when INTERNAL_PROVISION_SECRET is unset', async () => {
    delete process.env.INTERNAL_PROVISION_SECRET
    const res = await post({ organizationId: ORG, userId: USER, role: 'member' }, '')
    expect(res.status).toBe(401)
    expect(target).not.toHaveBeenCalled()
  })

  it('returns non-2xx (500) when Permit reports failure (false) so the consumer retries', async () => {
    target.mockResolvedValue(false)
    const res = await post({ organizationId: ORG, userId: USER, role: 'member' })
    expect(res.status).toBe(500)
  })

  it('returns non-2xx (500) when the Permit call throws', async () => {
    target.mockRejectedValue(new Error('permit down'))
    const res = await post({ organizationId: ORG, userId: USER, role: 'member' })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Membership sync failed')
  })
})

describe('POST /internal/devportal-provision', () => {
  const url = '/internal/devportal-provision'
  const post = (body: unknown, secret: string | null = SECRET) => {
    const r = request(makeApp()).post(url)
    if (secret !== null) r.set('x-internal-secret', secret)
    return r.send(body as object)
  }

  beforeEach(() => {
    process.env.INTERNAL_PROVISION_SECRET = SECRET
    mockEnsureDeveloperMembership.mockReset().mockResolvedValue(undefined)
    mockIsDevportalEnabled.mockReset().mockResolvedValue(true)
  })

  it('grants the separate developer-portal membership only when the portal flag is enabled', async () => {
    const res = await post({ userId: USER })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(mockIsDevportalEnabled).toHaveBeenCalledWith({ userId: USER })
    expect(mockEnsureDeveloperMembership).toHaveBeenCalledWith(USER)
  })

  it('fails closed without granting any membership while the portal flag is disabled', async () => {
    mockIsDevportalEnabled.mockResolvedValue(false)

    const res = await post({ userId: USER })

    expect(res.status).toBe(404)
    expect(mockEnsureDeveloperMembership).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller without evaluating the feature flag', async () => {
    const res = await post({ userId: USER }, 'wrong')

    expect(res.status).toBe(401)
    expect(mockIsDevportalEnabled).not.toHaveBeenCalled()
    expect(mockEnsureDeveloperMembership).not.toHaveBeenCalled()
  })
})
