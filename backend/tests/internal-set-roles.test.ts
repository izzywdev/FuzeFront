import request from 'supertest'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db, initializeDatabaseConnection } from '../src/config/database'

// internal.ts imports organizationProvisioning (→ Permit) at module load; mock
// those so importing the router never reaches a real Permit cloud. set-roles
// itself only touches db('users'), but the shared import graph still loads.
jest.mock('../src/utils/permit/tenant-management', () => ({
  __esModule: true,
  createTenantInPermit: jest.fn(async () => true),
  isAlreadyExistsError: jest.fn(() => false),
}))
jest.mock('../src/utils/permit/user-sync', () => ({
  __esModule: true,
  syncUserToPermit: jest.fn(async () => true),
}))
jest.mock('../src/utils/permit/role-assignment', () => ({
  __esModule: true,
  assignOrganizationRole: jest.fn(async () => true),
}))
jest.mock('../src/services/eventPublisher', () => ({
  __esModule: true,
  defaultEventPublisher: {
    publishIdentityUserCreated: jest.fn(async () => {}),
    publishNotifyEmailRequested: jest.fn(async () => {}),
  },
}))

import internalRoutes from '../src/routes/internal'

const SECRET = 'test-internal-secret'

const app = express()
app.use(express.json())
app.use('/internal', internalRoutes)

async function createUser(roles: string[] = ['user']): Promise<{ id: string; email: string }> {
  const id = uuidv4()
  const email = `setroles-${id.slice(0, 8)}@test.local`
  await db('users').insert({
    id,
    email,
    first_name: 'SetRoles',
    last_name: 'Test',
    roles: JSON.stringify(roles),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return { id, email }
}

async function rolesOf(id: string): Promise<string[]> {
  const row = await db('users').where({ id }).first()
  return typeof row.roles === 'string' ? JSON.parse(row.roles) : row.roles
}

describe('POST /internal/set-roles', () => {
  const prev = process.env.INTERNAL_PROVISION_SECRET
  beforeAll(() => {
    initializeDatabaseConnection()
    process.env.INTERNAL_PROVISION_SECRET = SECRET
  })
  afterAll(() => {
    process.env.INTERNAL_PROVISION_SECRET = prev
  })

  it('401s without the shared secret', async () => {
    const res = await request(app)
      .post('/internal/set-roles')
      .send({ email: 'x@test.local', roles: ['admin'] })
    expect(res.status).toBe(401)
  })

  it('401s with a same-length-but-wrong secret (timing-safe)', async () => {
    const sameLen = 'test-internal-WRONG!'
    expect(sameLen.length).toBe(SECRET.length)
    const res = await request(app)
      .post('/internal/set-roles')
      .set('x-internal-secret', sameLen)
      .send({ email: 'x@test.local', roles: ['admin'] })
    expect(res.status).toBe(401)
  })

  it('400s when email is missing', async () => {
    const res = await request(app)
      .post('/internal/set-roles')
      .set('x-internal-secret', SECRET)
      .send({ roles: ['admin'] })
    expect(res.status).toBe(400)
  })

  it('400s when roles is empty or not a string array', async () => {
    const empty = await request(app)
      .post('/internal/set-roles')
      .set('x-internal-secret', SECRET)
      .send({ email: 'x@test.local', roles: [] })
    expect(empty.status).toBe(400)

    const notStrings = await request(app)
      .post('/internal/set-roles')
      .set('x-internal-secret', SECRET)
      .send({ email: 'x@test.local', roles: [1, 2] })
    expect(notStrings.status).toBe(400)
  })

  it('400s on an unknown role (allowlist enforced)', async () => {
    const res = await request(app)
      .post('/internal/set-roles')
      .set('x-internal-secret', SECRET)
      .send({ email: 'x@test.local', roles: ['superuser'] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unknown role/i)
  })

  it('404s when no user has that email', async () => {
    const res = await request(app)
      .post('/internal/set-roles')
      .set('x-internal-secret', SECRET)
      .send({ email: `missing-${uuidv4()}@test.local`, roles: ['admin'] })
    expect(res.status).toBe(404)
  })

  it('grants admin by email, keeps `user`, and dedupes', async () => {
    const { id, email } = await createUser(['user'])
    const res = await request(app)
      .post('/internal/set-roles')
      .set('x-internal-secret', SECRET)
      .send({ email, roles: ['admin', 'user'] })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.userId).toBe(id)
    expect([...res.body.roles].sort()).toEqual(['admin', 'user'])
    expect((await rolesOf(id)).sort()).toEqual(['admin', 'user'])
  })

  it('matches email case-insensitively and is idempotent', async () => {
    const { id, email } = await createUser(['user'])
    const first = await request(app)
      .post('/internal/set-roles')
      .set('x-internal-secret', SECRET)
      .send({ email: email.toUpperCase(), roles: ['admin'] })
    expect(first.status).toBe(200)

    const second = await request(app)
      .post('/internal/set-roles')
      .set('x-internal-secret', SECRET)
      .send({ email, roles: ['admin'] })
    expect(second.status).toBe(200)
    // Re-run is a no-op: still exactly ['user','admin'], not appended.
    expect((await rolesOf(id)).sort()).toEqual(['admin', 'user'])
  })
})
