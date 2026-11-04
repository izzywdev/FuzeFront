// FFRNT-379 / S4 review fix (P1): loadVisibleApp in routes/app-installations.ts
// accepted every owning-org member, so with private-owner-only ON a non-creator
// member could still reach (and install) a `private` app and read its name/URL.
// With the flag ON, `private` narrows to creator / org owner / platform admin
// — and ONLY narrows (membership is still required first, so S2's effective
// access never widens the install write path). Flag OFF is byte-identical.
// Real queries against in-memory sqlite (no Postgres needed).
process.env.LOG_LEVEL = 'silent'
process.env.APP_INSTALL_READ_RATE_LIMIT = '100000'
process.env.APP_INSTALL_WRITE_RATE_LIMIT = '100000'

import express from 'express'
import request from 'supertest'

let mockIsPlatformAdmin = false

jest.mock('../src/config/database', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const knex = require('knex')
  return {
    db: knex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
  }
})
jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = req.headers['x-test-user']
      ? JSON.parse(req.headers['x-test-user'])
      : null
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })
    next()
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))
jest.mock('../src/app-registry/platform-admin', () => ({
  isRootOrgPlatformAdmin: async () => mockIsPlatformAdmin,
}))

import { db } from '../src/config/database'
import { setFlagClient, FLAGS } from '../src/app-registry/flags'
import appInstallationsRoutes from '../src/routes/app-installations'

const ORG = 'org-a'
let privateOnly = false
setFlagClient({
  getBooleanValue: async (key: string, def: boolean) =>
    key === FLAGS.PRIVATE_OWNER_ONLY ? privateOnly : def,
})

const as = (id: string) => ({ 'x-test-user': JSON.stringify({ id, roles: ['user'] }) })

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/apps', appInstallationsRoutes)
  return app
}

const getInstallations = (appId: string, user: string) =>
  request(buildApp()).get(`/api/apps/${appId}/installations`).set(as(user))
const postInstall = (appId: string, user: string) =>
  request(buildApp())
    .post(`/api/apps/${appId}/install`)
    .set(as(user))
    .send({ scope: 'personal' })

beforeAll(async () => {
  await db.schema.createTable('apps', t => {
    t.string('id').primary()
    t.string('name')
    t.string('visibility')
    t.string('organization_id')
    t.string('created_by_user_id')
    t.string('scope_level')
    t.string('org_install_mode')
  })
  await db.schema.createTable('organization_memberships', t => {
    t.string('user_id')
    t.string('organization_id')
    t.string('status')
    t.string('role')
  })
  await db.schema.createTable('organizations', t => {
    t.string('id')
    t.string('owner_id')
    t.boolean('is_active')
  })
  await db.schema.createTable('app_installations', t => {
    t.string('id')
    t.string('app_id')
    t.string('user_id')
    t.string('organization_id')
    t.string('scope')
    t.string('install_mode')
    t.string('status')
    t.timestamp('created_at')
  })
  await db('apps').insert([
    { id: 'priv', name: 'Priv', visibility: 'private', organization_id: ORG, created_by_user_id: 'creator', scope_level: 'both' },
    { id: 'orgapp', name: 'Org', visibility: 'organization', organization_id: ORG, created_by_user_id: 'creator', scope_level: 'both' },
    { id: 'pub', name: 'Pub', visibility: 'public', organization_id: 'org-z', created_by_user_id: null, scope_level: 'both' },
  ])
  const m = (user_id: string) => ({ user_id, organization_id: ORG, status: 'active', role: 'member' })
  await db('organization_memberships').insert([m('creator'), m('member'), m('owner'), m('admin')])
  await db('organizations').insert({ id: ORG, owner_id: 'owner', is_active: true })
})
beforeEach(() => {
  privateOnly = false
  mockIsPlatformAdmin = false
})
afterAll(async () => {
  await db.destroy()
})

describe('loadVisibleApp x private-owner-only (GET /:id/installations)', () => {
  it('flag OFF: any owning-org member reaches a private app (unchanged)', async () => {
    expect((await getInstallations('priv', 'member')).status).toBe(200)
  })

  it('flag ON: a non-creator org member gets 404 for a private app', async () => {
    privateOnly = true
    const res = await getInstallations('priv', 'member')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('APP_NOT_FOUND')
  })

  it('flag ON: the creator (still a member) is allowed', async () => {
    privateOnly = true
    expect((await getInstallations('priv', 'creator')).status).toBe(200)
  })

  it('flag ON: the org owner (a member) is allowed', async () => {
    privateOnly = true
    expect((await getInstallations('priv', 'owner')).status).toBe(200)
  })

  it('flag ON: a platform admin who is a member is allowed', async () => {
    privateOnly = true
    mockIsPlatformAdmin = true
    expect((await getInstallations('priv', 'admin')).status).toBe(200)
  })

  it('flag ON: never WIDENS — a non-member org owner/admin still gets 404', async () => {
    privateOnly = true
    mockIsPlatformAdmin = true
    expect((await getInstallations('priv', 'stranger')).status).toBe(404)
  })

  it('flag ON: organization and public apps are unaffected', async () => {
    privateOnly = true
    expect((await getInstallations('orgapp', 'member')).status).toBe(200)
    expect((await getInstallations('pub', 'stranger')).status).toBe(200)
  })

  it('flag ON: POST install (personal) of a private app by a non-creator member is 404 and writes nothing', async () => {
    privateOnly = true
    const res = await postInstall('priv', 'member')
    expect(res.status).toBe(404)
    expect(await db('app_installations').where('app_id', 'priv').count({ c: '*' })).toEqual([{ c: 0 }])
  })
})
