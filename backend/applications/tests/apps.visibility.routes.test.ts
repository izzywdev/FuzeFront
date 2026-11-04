// FFRNT-379 / S4 review fix (P1): the legacy list/health reads in routes/apps.ts
// (GET /api/apps and GET /api/apps/health) used to return EVERY active app —
// any org, any visibility — to any authenticated caller. They must scope to the
// caller exactly like app-registry list()/canRead, including the flagged
// private-owner-only rule. Runs the REAL query against in-memory sqlite so the
// WHERE-group is actually evaluated (not a hand-rolled fake of it).
process.env.LOG_LEVEL = 'silent'

import express from 'express'
import request from 'supertest'

let mockCaller: any

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
jest.mock('../src/app-registry/caller', () => ({
  resolveCaller: async () => mockCaller,
}))

import { db } from '../src/config/database'
import appsRoutes from '../src/routes/apps'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const USER = JSON.stringify({ id: 'member', roles: ['user'] })

function caller(over: any = {}) {
  return {
    userId: 'member',
    organizationIds: [ORG_A],
    roles: ['user'],
    isPlatformAdmin: false,
    ...over,
  }
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/apps', appsRoutes)
  return app
}

async function names(path: string): Promise<string[]> {
  const res = await request(buildApp()).get(path).set('x-test-user', USER)
  expect(res.status).toBe(200)
  return res.body.map((a: any) => a.name).sort()
}

beforeAll(async () => {
  ;(global as any).fetch = jest.fn(async () => ({ status: 200 }))
  await db.schema.createTable('apps', t => {
    t.string('id').primary()
    t.string('name')
    t.string('url')
    t.boolean('is_active')
    t.string('visibility')
    t.string('organization_id')
    t.string('created_by_user_id')
  })
  const row = (name: string, visibility: string, org: string, creator: string | null) => ({
    id: name,
    name,
    url: `http://${name}.example.com`,
    is_active: true,
    visibility,
    organization_id: org,
    created_by_user_id: creator,
  })
  await db('apps').insert([
    row('pub', 'public', ORG_B, null),
    row('market', 'marketplace', ORG_B, null),
    row('org-a-org', 'organization', ORG_A, 'someone'),
    row('org-a-priv-mine', 'private', ORG_A, 'member'),
    row('org-a-priv-other', 'private', ORG_A, 'someone'),
    row('org-b-org', 'organization', ORG_B, 'someone'),
    row('org-b-priv', 'private', ORG_B, 'someone'),
  ])
  await db('apps').insert({ ...row('inactive', 'public', ORG_A, null), is_active: false })
})
afterAll(async () => {
  await db.destroy()
})

describe.each(['/api/apps', '/api/apps/health'])('GET %s visibility scope', path => {
  it('flag OFF: public/marketplace + own-org organization/private; NEVER another org', async () => {
    mockCaller = caller()
    expect(await names(path)).toEqual(
      ['market', 'org-a-org', 'org-a-priv-mine', 'org-a-priv-other', 'pub'].sort()
    )
  })

  it('flag ON: private narrows to the creator; organization stays org-wide', async () => {
    mockCaller = caller({ privateOwnerOnly: true, ownedOrgIds: [] })
    expect(await names(path)).toEqual(
      ['market', 'org-a-org', 'org-a-priv-mine', 'pub'].sort()
    )
  })

  it('flag ON: the owning-org OWNER reads every private app in that org (not other orgs)', async () => {
    mockCaller = caller({
      userId: 'owner',
      organizationIds: [],
      effectiveReadOrgIds: [ORG_A],
      privateOwnerOnly: true,
      ownedOrgIds: [ORG_A],
    })
    expect(await names(path)).toEqual(
      ['market', 'org-a-org', 'org-a-priv-mine', 'org-a-priv-other', 'pub'].sort()
    )
  })

  it('a caller with no orgs sees only public/marketplace', async () => {
    mockCaller = caller({ organizationIds: [] })
    expect(await names(path)).toEqual(['market', 'pub'])
  })

  it('platform admin sees all ACTIVE apps', async () => {
    mockCaller = caller({ isPlatformAdmin: true, privateOwnerOnly: true, ownedOrgIds: [] })
    expect(await names(path)).toEqual(
      [
        'market', 'org-a-org', 'org-a-priv-mine', 'org-a-priv-other',
        'org-b-org', 'org-b-priv', 'pub',
      ].sort()
    )
  })
})
