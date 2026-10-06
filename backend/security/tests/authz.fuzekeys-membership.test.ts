import jwt from 'jsonwebtoken'
import { createHash } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { fromUuid } from '@izzywdev/fuzefront-identity'
import router from '../src/routes/authz'
import { getIdentityProvider } from '../src/providers/factory'
import { getAuthorizationProvider } from '../src/providers/authzFactory'
import { introspectMachineToken } from '../src/services/machine-identity'
import { findMembershipByUserAndOrg, findOrgById } from '../src/repositories/organizationRepository'

jest.mock('../src/providers/factory', () => ({ getIdentityProvider: jest.fn() }))
jest.mock('../src/providers/authzFactory', () => ({ getAuthorizationProvider: jest.fn() }))
jest.mock('../src/services/machine-identity', () => ({ introspectMachineToken: jest.fn() }))
jest.mock('../src/repositories/organizationRepository', () => ({
  findMembershipByUserAndOrg: jest.fn(), findOrgById: jest.fn(),
}))
jest.mock('../src/lib/logger', () => ({ withReqId: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }))

const subject = fromUuid('user', '11111111-1111-4111-8111-111111111111')
const tenant = fromUuid('organization', '22222222-2222-4222-8222-222222222222')
const provider = { check: jest.fn(), grant: jest.fn() }
const app = express().use(express.json()).use('/api/v1/security', router)
const tuple = { subject, tenant, role: 'owner', resource: { type: 'fuzekeys_Account', key: 'account:42' } }
const connectorKey = (targetTenant = tenant, targetSubject = subject, provider = 'gmail') => `connector:${createHash('sha256').update(JSON.stringify([targetTenant, targetSubject, provider]), 'utf8').digest('hex')}`
const grant = (body: typeof tuple & { connectorProvider?: unknown; membershipProof?: unknown; permission?: string } = tuple, token = 'operator') => request(app).post('/api/v1/security/authz/grants').set('Authorization', `Bearer ${token}`).send(body)
const proof = (token = 'operator') => request(app).get('/api/v1/security/authz/membership-proof').query({ subject, tenant }).set('Authorization', `Bearer ${token}`)

beforeEach(() => {
  jest.resetAllMocks()
  ;(getIdentityProvider as jest.Mock).mockReturnValue({ getUserInfo: jest.fn().mockRejectedValue(new Error('not human')) })
  ;(getAuthorizationProvider as jest.Mock).mockReturnValue(provider)
  ;(introspectMachineToken as jest.Mock).mockImplementation(async (token: string) => ({ active: true, client_id: 'operator', scope: token === 'operator' ? 'authz:admin' : 'read' }))
  ;(findMembershipByUserAndOrg as jest.Mock).mockResolvedValue({ status: 'active' })
  ;(findOrgById as jest.Mock).mockResolvedValue({ is_active: true })
  provider.grant.mockResolvedValue(tuple)
})

test.each([
  ['fuzekeys_Identity', 'identity:1'], ['fuzekeys_Account', 'account:42'], ['fuzekeys_VaultAsset', 'api-credential:9'],
])('grants only the exact active member %s instance', async (type, key) => {
  const body = { ...tuple, resource: { type, key } }
  await grant(body).expect(201)
  expect(provider.grant).toHaveBeenCalledWith({ ...body, permission: undefined })
  expect(findMembershipByUserAndOrg).toHaveBeenCalledWith(subject, tenant)
})

test.each(['pending', 'revoked', 'inactive'])('rejects %s membership at mutation time', async status => {
  ;(findMembershipByUserAndOrg as jest.Mock).mockResolvedValue({ status })
  await grant().expect(403)
  expect(provider.grant).not.toHaveBeenCalled()
})
test('an organization owner without an active membership cannot receive a grant', async () => {
  ;(findMembershipByUserAndOrg as jest.Mock).mockResolvedValue(undefined)
  ;(findOrgById as jest.Mock).mockResolvedValue({ is_active: true, owner_id: subject })
  await grant().expect(403)
  expect(provider.grant).not.toHaveBeenCalled()
})
test('inactive organization cannot receive grants', async () => {
  ;(findOrgById as jest.Mock).mockResolvedValue({ is_active: false })
  await grant().expect(403)
})
test.each([
  { type: 'fuzekeys_Account', key: '' }, { type: 'fuzekeys_Account', key: 'account:01' },
  { type: 'fuzekeys_Account', key: 'identity:42' }, { type: 'fuzekeys_Account', key: 'account:0' },
  { type: 'fuzekeys_Unknown', key: 'account:1' },
  { type: 'fuzekeys_Connector', key: '' },
  { type: 'fuzekeys_Connector', key: `connector:${'a'.repeat(63)}` },
  { type: 'fuzekeys_Connector', key: `connector:${'a'.repeat(65)}` },
  { type: 'fuzekeys_Connector', key: `connector:${'A'.repeat(64)}` },
  { type: 'fuzekeys_Connector', key: `connector:${'g'.repeat(64)}` },
  { type: 'fuzekeys_Connector', key: 'connector:*' },
  { type: 'fuzekeys_Connector', key: 'account:42' },
])('rejects a malformed or tenant-wide FuzeKeys resource %j', async resource => {
  await grant({ ...tuple, resource }).expect(400)
  expect(provider.grant).not.toHaveBeenCalled()
})
test('rejects escalation to tenant admin', async () => {
  await grant({ ...tuple, role: 'admin' }).expect(400)
})
test('rejects arbitrary permission grants', async () => {
  await grant({ ...tuple, permission: 'delete' } as any).expect(400)
})
test('unscoped machines cannot provision or enumerate membership', async () => {
  await grant(tuple, 'reader').expect(403)
  await proof('reader').expect(403)
  expect(findMembershipByUserAndOrg).not.toHaveBeenCalled()
})
test('human tenant administrator passes the existing Organization manage gate', async () => {
  ;(getIdentityProvider as jest.Mock).mockReturnValue({ getUserInfo: async () => ({ user: { id: subject } }) })
  provider.check.mockResolvedValue(true)
  await proof('human').expect(200)
  expect(provider.check).toHaveBeenCalledWith({ subject, tenant, resource: { type: 'Organization' }, action: 'manage' })
})
test('denied human administrator never learns SQL membership', async () => {
  ;(getIdentityProvider as jest.Mock).mockReturnValue({ getUserInfo: async () => ({ user: { id: subject } }) })
  provider.check.mockResolvedValue(false)
  await proof('human').expect(403)
  expect(findMembershipByUserAndOrg).not.toHaveBeenCalled()
})
test('proof returns canonical active membership and disables caching', async () => {
  const response = await proof().expect(200)
  expect(response.body).toEqual({ subject, tenant, active: true })
  expect(response.headers['cache-control']).toBe('no-store')
})
test('membership revoked after preflight is independently rechecked by grant', async () => {
  await proof().expect(200)
  ;(findMembershipByUserAndOrg as jest.Mock).mockResolvedValue(undefined)
  await grant().expect(403)
  expect(provider.grant).not.toHaveBeenCalled()
})
test('database failure returns unavailable without provisioning', async () => {
  ;(findMembershipByUserAndOrg as jest.Mock).mockRejectedValue(new Error('database down'))
  await proof().expect(503)
  await grant().expect(503)
  expect(provider.grant).not.toHaveBeenCalled()
})
test('invalid typed principal is rejected', async () => {
  await request(app).get('/api/v1/security/authz/membership-proof').query({ subject: 'not-user', tenant }).set('Authorization', 'Bearer operator').expect(400)
  await grant({ ...tuple, subject: 'not-user' } as any).expect(400)
})
test('unauthenticated proof is denied before membership access', async () => {
  await request(app).get('/api/v1/security/authz/membership-proof').query({ subject, tenant }).expect(401)
  expect(findMembershipByUserAndOrg).not.toHaveBeenCalled()
})

describe('exact Connector owner grants', () => {
  const connector = { ...tuple, connectorProvider: 'gmail', resource: { type: 'fuzekeys_Connector', key: connectorKey() } }
  test('the reviewed exact owner tuple reaches the provider without metadata authority', async () => {
    const response = await grant(connector).expect(201)
    expect(provider.grant).toHaveBeenCalledWith({ ...tuple, resource: connector.resource, permission: undefined })
    expect(findMembershipByUserAndOrg).toHaveBeenCalledWith(subject, tenant)
    expect(response.body.connectorProvider).toBe('gmail')
  })
  test('the Python inventory hash vector matches the exact UTF-8 wire tuple', async () => {
    const rawSubject = '11111111-1111-4111-8111-111111111111'
    const rawTenant = '22222222-2222-4222-8222-222222222222'
    await grant({ ...connector, subject: rawSubject, tenant: rawTenant, connectorProvider: 'google-drive',
      resource: { type: 'fuzekeys_Connector', key: 'connector:2c54e5b0a0f8fcc1acb627fdb060289490ba622a184b964326dd97c804c89fff' } } as any).expect(201)
    expect(provider.grant).toHaveBeenCalledWith({ subject: rawSubject, tenant: rawTenant, role: 'owner', permission: undefined,
      resource: { type: 'fuzekeys_Connector', key: 'connector:2c54e5b0a0f8fcc1acb627fdb060289490ba622a184b964326dd97c804c89fff' } })
    expect(findMembershipByUserAndOrg).toHaveBeenCalledWith(subject, tenant)
  })
  test.each([undefined, '', 'Gmail', 'gmail/drive', 'g'.repeat(81), 'google_drive'])('invalid provider %j cannot provision', async connectorProvider => {
    await grant({ ...connector, connectorProvider }).expect(400)
    expect(provider.grant).not.toHaveBeenCalled()
  })
  test('a well-shaped key for another immutable owner tuple is rejected', async () => {
    await grant({ ...connector, resource: { ...connector.resource, key: `connector:${'a'.repeat(64)}` } }).expect(400)
    await grant({ ...connector, connectorProvider: 'github' }).expect(400)
    expect(provider.grant).not.toHaveBeenCalled()
  })
  test('runtime callers cannot mint grants from a claimed owner or proof', async () => {
    await grant({ ...connector, membershipProof: { subject, tenant, active: true } } as any, 'reader').expect(403)
    expect(findMembershipByUserAndOrg).not.toHaveBeenCalled()
    expect(provider.grant).not.toHaveBeenCalled()
  })
  test('membership is read afresh rather than accepting caller proof', async () => {
    await proof().expect(200)
    ;(findMembershipByUserAndOrg as jest.Mock).mockResolvedValue(undefined)
    await grant({ ...connector, membershipProof: { subject, tenant, active: true } } as any).expect(403)
    expect(provider.grant).not.toHaveBeenCalled()
  })
  test('membership for another tenant does not authorize the target', async () => {
    const otherTenant = fromUuid('organization', '33333333-3333-4333-8333-333333333333')
    ;(findMembershipByUserAndOrg as jest.Mock).mockImplementation(async (_subject, targetTenant) => targetTenant === tenant ? { status: 'active' } : undefined)
    await grant({ ...connector, tenant: otherTenant, resource: { ...connector.resource, key: connectorKey(otherTenant) } }).expect(403)
    expect(findMembershipByUserAndOrg).toHaveBeenCalledWith(subject, otherTenant)
    expect(provider.grant).not.toHaveBeenCalled()
  })
  test('malformed subject and tenant cannot become mapped principals', async () => {
    await grant({ ...connector, subject: 'claimed-owner' } as any).expect(400)
    await grant({ ...connector, tenant: 'directory-tenant' } as any).expect(400)
    expect(provider.grant).not.toHaveBeenCalled()
  })
  test('membership database failure does not provision Connector access', async () => {
    ;(findMembershipByUserAndOrg as jest.Mock).mockRejectedValue(new Error('database unavailable'))
    await grant(connector).expect(503)
    expect(provider.grant).not.toHaveBeenCalled()
  })
  test('role escalation and arbitrary permissions are denied', async () => {
    await grant({ ...connector, role: 'admin' }).expect(400)
    await grant({ ...connector, permission: 'write_credential' } as any).expect(400)
    expect(provider.grant).not.toHaveBeenCalled()
  })
})

describe('Security workload operator token', () => {
  const previous = process.env.DELEGATION_SIGNING_KEY
  beforeEach(() => { process.env.DELEGATION_SIGNING_KEY = 'test-signing-key' })
  afterEach(() => {
    if (previous === undefined) delete process.env.DELEGATION_SIGNING_KEY
    else process.env.DELEGATION_SIGNING_KEY = previous
  })
  const token = (audience = 'fuzefront-services', scope = 'authz:admin') => jwt.sign(
    { kind: 'fuze-workload', sub: 'service:provisioner', scope },
    'test-signing-key', { algorithm: 'HS256', issuer: 'fuzefront-security', audience, expiresIn: '1m' }
  )
  test('verified operator workload can prove and grant exact ownership', async () => {
    await proof(token()).expect(200)
    await grant(tuple, token()).expect(201)
    expect(introspectMachineToken).not.toHaveBeenCalled()
  })
  test('unscoped workload cannot enumerate or grant', async () => {
    await proof(token('fuzefront-services', 'read')).expect(403)
    await grant(tuple, token('fuzefront-services', 'read')).expect(403)
    expect(provider.grant).not.toHaveBeenCalled()
  })
  test('wrong-audience workload is rejected when not a valid external token', async () => {
    ;(introspectMachineToken as jest.Mock).mockResolvedValue({ active: false })
    await proof(token('other-service')).expect(401)
    expect(findMembershipByUserAndOrg).not.toHaveBeenCalled()
  })
})
