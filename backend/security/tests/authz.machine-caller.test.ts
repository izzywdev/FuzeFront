/**
 * Machine (S2S) caller tests for the live `/authz/*` HTTP surface —
 * izzywdev/FuzeFront authz-live-s2s.
 *
 * These prove the specific gap this branch closes: a service OUTSIDE
 * FuzeFront, holding only a `client_credentials` machine token (never a
 * FuzeFront human session token), can call `POST /authz/check` and get an
 * authoritative allow/deny, and an operator machine identity (holding the
 * `authz:admin` scope) can grant/revoke that decision over the same HTTP API.
 *
 * `getIdentityProvider().getUserInfo()` is mocked to ALWAYS reject here (no
 * human session exists for any of these tokens) so every request in this file
 * is forced down the machine-token fallback path in `caller()`.
 */
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
  // No FuzeFront human session ever recognizes these tokens — forces every
  // request in this file down the machine-token path.
  getUserInfo: jest.fn().mockRejectedValue(new Error('not a session token')),
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
}

const CALLER_TOKEN = 'machine-token-fuzecall-backend'
const OPERATOR_TOKEN = 'machine-token-operator'

beforeEach(() => {
  jest.clearAllMocks()
  setIdentityProvider(identityProvider as any)
  setAuthorizationProvider(authorizationProvider as any)
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

afterEach(() => {
  setIdentityProvider(null)
  setAuthorizationProvider(null)
})

describe('POST /api/v1/security/authz/check — machine callers', () => {
  it('allow: a machine caller asking about itself gets allow:true from the provider', async () => {
    authorizationProvider.check.mockResolvedValue(true)

    const res = await request(buildApp())
      .post('/api/v1/security/authz/check')
      .set('Authorization', `Bearer ${CALLER_TOKEN}`)
      .send({ tenant: 'default', resource: { type: 'ServiceEndpoint', key: 'fuzecall_control_plane' }, action: 'invoke' })
      .expect(200)

    expect(res.body).toEqual({ allow: true })
    // subject defaulted to the caller's own svc:<client_id> — the self-check case.
    expect(authorizationProvider.check).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'svc:fuzecall-backend', action: 'invoke' })
    )
  })

  it('deny: the provider says no', async () => {
    authorizationProvider.check.mockResolvedValue(false)

    const res = await request(buildApp())
      .post('/api/v1/security/authz/check')
      .set('Authorization', `Bearer ${CALLER_TOKEN}`)
      .send({ tenant: 'default', resource: { type: 'ServiceEndpoint', key: 'fuzecall_control_plane' }, action: 'invoke' })
      .expect(200)

    expect(res.body).toEqual({ allow: false })
  })

  it('unknown caller: a valid machine token for a client_id with no grants denies, it does not error', async () => {
    authorizationProvider.check.mockResolvedValue(false)

    const res = await request(buildApp())
      .post('/api/v1/security/authz/check')
      .set('Authorization', `Bearer ${CALLER_TOKEN}`)
      .send({ tenant: 'default', subject: 'svc:never-provisioned', resource: { type: 'ServiceEndpoint', key: 'fuzecall_control_plane' }, action: 'invoke' })
      .expect(200)

    expect(res.body).toEqual({ allow: false })
  })

  it('PDP unreachable ⇒ deny: a provider error resolves to an explicit allow:false, never a 500', async () => {
    authorizationProvider.check.mockRejectedValue(new Error('PDP unreachable: connect ETIMEDOUT'))

    const res = await request(buildApp())
      .post('/api/v1/security/authz/check')
      .set('Authorization', `Bearer ${CALLER_TOKEN}`)
      .send({ tenant: 'default', resource: { type: 'ServiceEndpoint', key: 'fuzecall_control_plane' }, action: 'invoke' })
      .expect(200)

    expect(res.body).toEqual({ allow: false })
  })

  it('unauthenticated caller rejected: an inactive/unrecognized token gets 401, not a default identity', async () => {
    const res = await request(buildApp())
      .post('/api/v1/security/authz/check')
      .set('Authorization', 'Bearer garbage-token-nobody-issued')
      .send({ tenant: 'default', resource: { type: 'ServiceEndpoint', key: 'fuzecall_control_plane' }, action: 'invoke' })
      .expect(401)

    expect(res.body.code).toBe('AUTH_REQUIRED')
    expect(authorizationProvider.check).not.toHaveBeenCalled()
  })

  it('unauthenticated caller rejected: no bearer token at all gets 401', async () => {
    const res = await request(buildApp())
      .post('/api/v1/security/authz/check')
      .send({ tenant: 'default', resource: { type: 'ServiceEndpoint', key: 'fuzecall_control_plane' }, action: 'invoke' })
      .expect(401)

    expect(res.body.code).toBe('AUTH_REQUIRED')
  })
})

describe('POST /api/v1/security/authz/bulk-check — PDP unreachable', () => {
  it('a provider error denies every element in the batch, index-aligned, never a 500', async () => {
    authorizationProvider.bulkCheck.mockRejectedValue(new Error('PDP unreachable'))

    const res = await request(buildApp())
      .post('/api/v1/security/authz/bulk-check')
      .set('Authorization', `Bearer ${CALLER_TOKEN}`)
      .send({
        checks: [
          { tenant: 'default', resource: { type: 'ServiceEndpoint', key: 'a' }, action: 'invoke' },
          { tenant: 'default', resource: { type: 'ServiceEndpoint', key: 'b' }, action: 'invoke' },
        ],
      })
      .expect(200)

    expect(res.body).toEqual({ decisions: [{ allow: false }, { allow: false }] })
  })
})

describe('POST/DELETE /api/v1/security/authz/grants — machine callers require authz:admin', () => {
  it('a machine caller WITHOUT the authz:admin scope is forbidden from granting', async () => {
    const res = await request(buildApp())
      .post('/api/v1/security/authz/grants')
      .set('Authorization', `Bearer ${CALLER_TOKEN}`) // scope: s2s:fuzecall only
      .send({ subject: 'svc:fuzecall-backend', tenant: 'default', role: 's2s-caller', resource: { type: 'ServiceEndpoint', key: 'fuzecall_control_plane' } })
      .expect(403)

    expect(res.body.code).toBe('FORBIDDEN')
    expect(authorizationProvider.grant).not.toHaveBeenCalled()
  })

  it('a machine caller WITHOUT the authz:admin scope is forbidden from revoking', async () => {
    const res = await request(buildApp())
      .delete('/api/v1/security/authz/grants')
      .set('Authorization', `Bearer ${CALLER_TOKEN}`)
      .send({ subject: 'svc:fuzecall-backend', tenant: 'default', role: 's2s-caller' })
      .expect(403)

    expect(res.body.code).toBe('FORBIDDEN')
    expect(authorizationProvider.revoke).not.toHaveBeenCalled()
  })

  it('grant → check ⇒ allow: an operator machine caller (authz:admin) can grant, and a subsequent check reflects it', async () => {
    authorizationProvider.grant.mockResolvedValue({
      id: 'default:svc:fuzecall-backend:s2s-caller',
      subject: 'svc:fuzecall-backend',
      tenant: 'default',
      role: 's2s-caller',
      resource: { type: 'ServiceEndpoint', key: 'fuzecall_control_plane' },
    })

    const grantRes = await request(buildApp())
      .post('/api/v1/security/authz/grants')
      .set('Authorization', `Bearer ${OPERATOR_TOKEN}`)
      .send({
        subject: 'svc:fuzecall-backend',
        tenant: 'default',
        role: 's2s-caller',
        resource: { type: 'ServiceEndpoint', key: 'fuzecall_control_plane' },
      })
      .expect(201)
    expect(grantRes.body.role).toBe('s2s-caller')

    // The grant having happened is now reflected by the provider on check.
    authorizationProvider.check.mockResolvedValue(true)
    const checkRes = await request(buildApp())
      .post('/api/v1/security/authz/check')
      .set('Authorization', `Bearer ${CALLER_TOKEN}`)
      .send({ tenant: 'default', resource: { type: 'ServiceEndpoint', key: 'fuzecall_control_plane' }, action: 'invoke' })
      .expect(200)
    expect(checkRes.body).toEqual({ allow: true })
  })

  it('revoke → check ⇒ deny: an operator machine caller can revoke, and a subsequent check reflects it', async () => {
    authorizationProvider.revoke.mockResolvedValue(undefined)

    await request(buildApp())
      .delete('/api/v1/security/authz/grants')
      .set('Authorization', `Bearer ${OPERATOR_TOKEN}`)
      .send({ subject: 'svc:fuzecall-backend', tenant: 'default', role: 's2s-caller' })
      .expect(204)
    expect(authorizationProvider.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'svc:fuzecall-backend', tenant: 'default', role: 's2s-caller' })
    )

    authorizationProvider.check.mockResolvedValue(false)
    const checkRes = await request(buildApp())
      .post('/api/v1/security/authz/check')
      .set('Authorization', `Bearer ${CALLER_TOKEN}`)
      .send({ tenant: 'default', resource: { type: 'ServiceEndpoint', key: 'fuzecall_control_plane' }, action: 'invoke' })
      .expect(200)
    expect(checkRes.body).toEqual({ allow: false })
  })
})
