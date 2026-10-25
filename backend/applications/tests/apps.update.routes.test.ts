// Route tests for the admin app-update path: PUT /api/apps/:id in routes/apps.ts.
// Before this route existed the /admin "Edit" form's submit was a no-op stub, so
// editing any app did nothing. `apps` is a compact in-memory fake knex; auth is
// injected via the middleware DI seam (admin-gated).
process.env.LOG_LEVEL = 'silent'

import express from 'express'
import request from 'supertest'

interface Row {
  [k: string]: any
}
let appRows: Row[] = []

function appsQuery() {
  const preds: ((r: Row) => boolean)[] = []
  const run = () => appRows.filter(r => preds.every(p => p(r)))
  const q: any = {
    where(arg: any, val?: any) {
      if (typeof arg === 'object')
        preds.push(r => Object.entries(arg).every(([k, v]) => r[k] === v))
      else preds.push(r => r[arg] === val)
      return q
    },
    first: async () => run()[0],
    update: async (patch: Row) => {
      const m = run()
      m.forEach(r => Object.assign(r, patch))
      return m.length
    },
  }
  return q
}
const fakeDb: any = (t: string) => {
  if (t !== 'apps') throw new Error(`fake-db: unexpected table ${t}`)
  return appsQuery()
}
fakeDb.fn = { now: () => '2026-10-19T00:00:00Z' }
jest.mock('../src/config/database', () => ({ db: fakeDb }))
jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = req.headers['x-test-user']
      ? JSON.parse(req.headers['x-test-user'])
      : null
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })
    next()
  },
  requireRole: (roles: string[]) => (req: any, res: any, next: any) => {
    const have: string[] = req.user?.roles ?? []
    if (!roles.some(r => have.includes(r)))
      return res.status(403).json({ error: 'forbidden' })
    next()
  },
}))

import appsRoutes from '../src/routes/apps'

const ADMIN = JSON.stringify({ id: 'u1', roles: ['admin', 'user'] })
const USER = JSON.stringify({ id: 'u2', roles: ['user'] })

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/apps', appsRoutes)
  return app
}

describe('PUT /api/apps/:id — admin app update', () => {
  let app: express.Application
  beforeEach(() => {
    appRows = [
      {
        id: 'app-1',
        name: 'Old Name',
        url: 'http://old.example.com',
        icon_url: null,
        integration_type: 'iframe',
        remote_url: null,
        scope: null,
        module: null,
        description: 'old',
        visibility: 'private',
        scope_level: 'both',
        is_active: true,
      },
    ]
    app = buildApp()
  })

  it('updates allow-listed fields and returns the new DTO', async () => {
    const res = await request(app)
      .put('/api/apps/app-1')
      .set('x-test-user', ADMIN)
      .send({ name: 'New Name', description: 'new', scopeLevel: 'organization' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('New Name')
    expect(res.body.description).toBe('new')
    expect(res.body.scopeLevel).toBe('organization')
    expect(appRows[0].name).toBe('New Name')
    expect(appRows[0].scope_level).toBe('organization')
  })

  it('404s for an unknown app id', async () => {
    const res = await request(app)
      .put('/api/apps/does-not-exist')
      .set('x-test-user', ADMIN)
      .send({ name: 'x' })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('APP_NOT_FOUND')
  })

  it('rejects an invalid scopeLevel with 400', async () => {
    const res = await request(app)
      .put('/api/apps/app-1')
      .set('x-test-user', ADMIN)
      .send({ scopeLevel: 'nonsense' })
    expect(res.status).toBe(400)
  })

  it('requires admin (403 for a plain user)', async () => {
    const res = await request(app)
      .put('/api/apps/app-1')
      .set('x-test-user', USER)
      .send({ name: 'x' })
    expect(res.status).toBe(403)
  })

  it('409s USE_APP_REGISTRY for a manifest-backed row and leaves it untouched', async () => {
    appRows.push({
      id: 'app-2',
      name: 'Registry App',
      slug: 'regapp',
      manifest: { slug: 'regapp', name: 'Registry App' },
      url: 'http://reg.example.com',
      integration_type: 'iframe',
      scope_level: 'both',
      is_active: true,
    })
    const res = await request(app)
      .put('/api/apps/app-2')
      .set('x-test-user', ADMIN)
      .send({ name: 'Renamed' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('USE_APP_REGISTRY')
    expect(res.body.slug).toBe('regapp')
    expect(appRows[1].name).toBe('Registry App')
  })
})
