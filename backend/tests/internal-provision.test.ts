import request from 'supertest'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db, initializeDatabaseConnection } from '../src/config/database'

// The internal route's runInternalProvision uses the DEFAULT deps (real Permit +
// publisher). We mock those modules so nothing touches a real Permit cloud or
// broker, while still exercising the real route auth + DB writes.
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

async function createUser(): Promise<string> {
  const id = uuidv4()
  await db('users').insert({
    id,
    email: `int-${id.slice(0, 8)}@test.local`,
    first_name: 'Int',
    last_name: 'Test',
    roles: JSON.stringify(['user']),
    created_at: new Date(),
    updated_at: new Date(),
  })
  return id
}

describe('POST /internal/provision', () => {
  const prev = process.env.INTERNAL_PROVISION_SECRET
  beforeAll(() => {
    // The global setup runs migrations/seeds but does not open the runtime
    // connection; open it here so `db(...)` is usable.
    initializeDatabaseConnection()
    process.env.INTERNAL_PROVISION_SECRET = SECRET
  })
  afterAll(() => {
    process.env.INTERNAL_PROVISION_SECRET = prev
  })

  it('401s without the shared secret', async () => {
    const res = await request(app)
      .post('/internal/provision')
      .send({ userId: uuidv4() })
    expect(res.status).toBe(401)
  })

  it('401s with a wrong shared secret', async () => {
    const res = await request(app)
      .post('/internal/provision')
      .set('x-internal-secret', 'nope')
      .send({ userId: uuidv4() })
    expect(res.status).toBe(401)
  })

  // I1 — timing-safe compare: empty string, same-length wrong value, and
  // correct value all handled correctly (no oracle leak).
  it('401s with an empty secret header (I1)', async () => {
    const res = await request(app)
      .post('/internal/provision')
      .set('x-internal-secret', '')
      .send({ userId: uuidv4() })
    expect(res.status).toBe(401)
  })

  it('401s with a same-length-but-wrong secret (I1 timing-safe)', async () => {
    // SECRET is 'test-internal-secret' (20 chars); craft same-length wrong value.
    const sameLen = 'test-internal-WRONG!'
    expect(sameLen.length).toBe(SECRET.length)
    const res = await request(app)
      .post('/internal/provision')
      .set('x-internal-secret', sameLen)
      .send({ userId: uuidv4() })
    expect(res.status).toBe(401)
  })

  it('200s with the exact correct secret (I1)', async () => {
    const userId = await createUser()
    const res = await request(app)
      .post('/internal/provision')
      .set('x-internal-secret', SECRET)
      .send({ userId })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('400s when userId is missing', async () => {
    const res = await request(app)
      .post('/internal/provision')
      .set('x-internal-secret', SECRET)
      .send({})
    expect(res.status).toBe(400)
  })

  it('provisions a user with the correct secret', async () => {
    const userId = await createUser()
    const res = await request(app)
      .post('/internal/provision')
      .set('x-internal-secret', SECRET)
      .send({ userId })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.personalOrgId).toBeTruthy()

    const personal = await db('organizations')
      .where({ id: res.body.personalOrgId })
      .first()
    expect(personal.type).toBe('personal')
    expect(personal.provisioning_state).toBe('active')
  })
})
