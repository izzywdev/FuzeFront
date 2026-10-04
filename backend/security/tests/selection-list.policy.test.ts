import express from 'express'
import request from 'supertest'
import { permitSchema } from '../src/permit/schema'
import { syncPermitSchema } from '../src/permit/sync-permit-schema'
import authzRoutes from '../src/routes/authz'
import { setIdentityProvider } from '../src/providers/factory'
import { setAuthorizationProvider } from '../src/providers/authzFactory'
import { findMembershipByUserAndOrg } from '../src/repositories/organizationRepository'
import { introspectMachineToken } from '../src/services/machine-identity'
import jwt from 'jsonwebtoken'

jest.mock('../src/repositories/organizationRepository', () => ({
  findMembershipByUserAndOrg: jest.fn(),
}))
jest.mock('../src/services/machine-identity', () => ({
  introspectMachineToken: jest.fn(),
}))

const membership = findMembershipByUserAndOrg as jest.Mock
const introspect = introspectMachineToken as jest.Mock
const authz = {
  check: jest.fn(),
  grant: jest.fn(),
  revoke: jest.fn(),
}

const app = express()
app.use(express.json())
app.use('/api/v1/security', authzRoutes)

beforeEach(() => {
  jest.clearAllMocks()
  setIdentityProvider({ getUserInfo: async () => ({ user: { id: 'caller' } }) } as any)
  setAuthorizationProvider(authz as any)
  membership.mockResolvedValue({ status: 'active' })
  introspect.mockResolvedValue({ active: false })
  authz.check.mockResolvedValue(false)
  authz.grant.mockImplementation(async (body) => body)
  authz.revoke.mockResolvedValue(undefined)
})

afterEach(() => {
  setIdentityProvider(null)
  setAuthorizationProvider(null)
})

const listGrant = {
  subject: 'target', tenant: 'tenant', role: 'list-editor',
  resource: { type: 'SelectionList', key: 'list-a' },
}

test('schema matches every list role action and keeps tenant member permissions instance safe', () => {
  const resource = permitSchema.resources.find(r => r.key === 'SelectionList')!
  expect(Object.keys(resource.actions)).toEqual([
    'list', 'create', 'read', 'add_value', 'update_value', 'remove_value',
    'translate', 'update', 'delete', 'manage_access',
  ])
  expect(resource.roles?.['list-owner'].permissions).toEqual([
    'read', 'add_value', 'update_value', 'remove_value', 'translate',
    'update', 'delete', 'manage_access',
  ])
  for (const role of ['editor', 'viewer']) {
    const permissions = permitSchema.roles.find(r => r.key === role)!.permissions
    expect(permissions).toContain('SelectionList:list')
    expect(permissions).not.toContain('SelectionList:read')
    expect(permissions).not.toContain('SelectionList:manage_access')
  }
})

test('schema sync sends resource roles to Permit', async () => {
  const created = jest.fn().mockResolvedValue(undefined)
  const permit = {
    api: {
      resources: { get: jest.fn().mockRejectedValue(new Error('missing')), create: created, update: jest.fn() },
      roles: { get: jest.fn().mockRejectedValue(new Error('missing')), create: jest.fn(), update: jest.fn() },
    },
  }
  await syncPermitSchema(permit, permitSchema, () => undefined)
  expect(created).toHaveBeenCalledWith(expect.objectContaining({
    key: 'SelectionList', roles: expect.objectContaining({ 'list-owner': expect.any(Object) }),
  }))
})

test('human cannot self-grant list ownership without manage_access', async () => {
  await request(app).post('/api/v1/security/authz/grants')
    .set('Authorization', 'Bearer valid')
    .send({ ...listGrant, subject: 'caller', role: 'list-owner' })
    .expect(403)
  expect(authz.grant).not.toHaveBeenCalled()
})

test('management permission on a different list cannot grant this list', async () => {
  authz.check.mockImplementation(async (query) => query.resource.key === 'list-b')
  await request(app).post('/api/v1/security/authz/grants')
    .set('Authorization', 'Bearer valid').send(listGrant).expect(403)
  expect(authz.grant).not.toHaveBeenCalled()
})

test('human cannot bypass list policy by granting themselves tenant admin', async () => {
  await request(app).post('/api/v1/security/authz/grants')
    .set('Authorization', 'Bearer valid')
    .send({ subject: 'caller', tenant: 'tenant', role: 'admin' }).expect(403)
  expect(authz.check).toHaveBeenCalledWith({
    subject: 'caller', tenant: 'tenant',
    resource: { type: 'Organization', key: 'tenant' }, action: 'manage',
  })
  expect(authz.grant).not.toHaveBeenCalled()
})

test('list owner can grant an active member on that list only', async () => {
  authz.check.mockResolvedValue(true)
  await request(app).post('/api/v1/security/authz/grants')
    .set('Authorization', 'Bearer valid').send(listGrant).expect(201)
  expect(authz.check).toHaveBeenCalledWith({
    subject: 'caller', tenant: 'tenant',
    resource: { type: 'SelectionList', key: 'list-a' }, action: 'manage_access',
  })
  expect(authz.grant).toHaveBeenCalledTimes(1)
})

test('inactive target member and unscoped list role are denied', async () => {
  membership.mockResolvedValue({ status: 'revoked' })
  await request(app).post('/api/v1/security/authz/grants')
    .set('Authorization', 'Bearer valid').send(listGrant).expect(403)
  await request(app).post('/api/v1/security/authz/grants')
    .set('Authorization', 'Bearer valid')
    .send({ subject: 'target', tenant: 'tenant', role: 'list-owner' }).expect(403)
  expect(authz.grant).not.toHaveBeenCalled()
})

test('dedicated workload can grant first owner but cannot grant other roles or revoke', async () => {
  setIdentityProvider({ getUserInfo: async () => { throw new Error('not a session') } } as any)
  process.env.JWT_SECRET = 'selection-list-test-signing-key'
  const token = jwt.sign({ kind: 'fuze-workload', sub: 'service:selection-list-service',
    aud: 'fuzefront-services', scope: 'selection-list:owner-grant' },
  process.env.JWT_SECRET, { issuer: 'fuzefront-security', expiresIn: 60 })
  await request(app).post('/api/v1/security/authz/grants')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...listGrant, role: 'list-owner' }).expect(201)
  await request(app).post('/api/v1/security/authz/grants')
    .set('Authorization', `Bearer ${token}`)
    .send(listGrant).expect(403)
  await request(app).delete('/api/v1/security/authz/grants')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...listGrant, role: 'list-owner' }).expect(403)
  expect(authz.grant).toHaveBeenCalledTimes(1)
  expect(authz.revoke).not.toHaveBeenCalled()
  const otherService = jwt.sign({ kind: 'fuze-workload', sub: 'service:other',
    aud: 'fuzefront-services', scope: 'selection-list:owner-grant' },
  process.env.JWT_SECRET, { issuer: 'fuzefront-security', expiresIn: 60 })
  await request(app).post('/api/v1/security/authz/grants')
    .set('Authorization', `Bearer ${otherService}`)
    .send({ ...listGrant, role: 'list-owner' }).expect(403)
  delete process.env.JWT_SECRET
})
