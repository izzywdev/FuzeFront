// Integration tests for the legacy app registry (src/routes/apps.ts), the
// LIVE /api/apps implementation (see deploy/route-ownership.json).
//
// Ported from backend/tests/apps.test.ts, which tested the now-deleted
// backend/src/routes/apps.ts — dead code that never received a single real
// request (ingress routes /api/apps to fuzefront-applications, not
// fuzefront-backend). This file is the sole surviving/expanded coverage for
// the app-registry route logic.
//
// Both states of fuzefront.apps-registry.object-level-authz are exercised:
// OFF (the flag default, and the exact pre-fix behavior this router already
// shipped with) and ON (the ported appsec #100 fix). See
// src/app-registry/flags.ts for the flag's full rationale.
//
// Runs against a REAL Postgres (same convention as tests/app-installations.
// test.ts) so validation, uniqueness and the schema itself are exercised
// alongside the route logic. Auth is mocked to a settable current user — the
// authorization rules under test all live in the route/requireAppAction, not
// in JWT verification.

let currentUser: { id: string; email: string; roles: string[] } | null = null

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    if (!currentUser) {
      return res
        .status(401)
        .json({ error: 'Access denied. No token provided.' })
    }
    req.user = currentUser
    next()
  },
  requireRole: (roles: string[]) => (req: any, res: any, next: any) => {
    const userRoles: string[] = req.user?.roles || []
    if (!roles.some(r => userRoles.includes(r))) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    next()
  },
}))

import request from 'supertest'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'

process.env.NODE_ENV = process.env.NODE_ENV || 'test'
process.env.USE_POSTGRES = 'true'
process.env.DB_HOST = process.env.DB_HOST || 'localhost'
process.env.DB_PORT = process.env.DB_PORT || '5432'
process.env.DB_NAME = process.env.DB_NAME || 'fuzefront_platform'
process.env.DB_USER = process.env.DB_USER || 'postgres'
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres'

import path from 'path'
import appsRoutes from '../src/routes/apps'
import { setFlagClient, FLAGS } from '../src/app-registry/flags'
import { setPermitClient } from '../src/app-registry/permit'
import {
  initializeDatabaseConnection,
  runMigrations,
  closeDatabase,
  db,
} from '../src/config/database'

// The backend's migration chain, not this service's — apps.organization_id /
// visibility / scope_level (006, 017) live there. Same convention as
// tests/app-installations.test.ts.
const BACKEND_MIGRATIONS_DIR = path.resolve(__dirname, '../../src/migrations')

// Flag DI: pinned per-describe-block so both states are exercised
// deterministically, no network, per the feature-flags skill.
let authzFlag = false
setFlagClient({
  getBooleanValue: async (key: string, def: boolean) => {
    if (key === FLAGS.LEGACY_OBJECT_LEVEL_AUTHZ) return authzFlag
    return def
  },
})

// Permit DI: denies by default (matches getPermitClient's own fail-closed
// no-op); flipped per-test where the Permit fallback path is exercised.
let permitGrant = false
setPermitClient({ check: async () => permitGrant })

function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.set('io', { emit: () => undefined })
  app.use('/api/apps', appsRoutes)
  return app
}

const suffix = uuidv4().slice(0, 8)

describe('Legacy app registry (routes/apps.ts)', () => {
  let app: express.Application
  const createdAppNames = new Set<string>()

  const ADMIN = {
    id: uuidv4(),
    email: `admin-${suffix}@test.local`,
    roles: ['admin', 'user'],
  }
  const USER = { id: uuidv4(), email: `user-${suffix}@test.local`, roles: ['user'] }

  async function postApp(appData: Record<string, any>, actor = ADMIN) {
    if (appData && typeof appData.name === 'string') {
      createdAppNames.add(appData.name.trim())
    }
    currentUser = actor
    return request(app).post('/api/apps').send(appData)
  }

  beforeAll(async () => {
    await runMigrations({
      migrationsTableName: 'knex_migrations',
      migrationsDir: BACKEND_MIGRATIONS_DIR,
    })
    initializeDatabaseConnection()
    app = buildApp()

    await db('users').insert([
      {
        id: ADMIN.id,
        email: ADMIN.email,
        password_hash: null,
        first_name: 'Admin',
        last_name: 'User',
        roles: JSON.stringify(ADMIN.roles),
      },
      {
        id: USER.id,
        email: USER.email,
        password_hash: null,
        first_name: 'Plain',
        last_name: 'User',
        roles: JSON.stringify(USER.roles),
      },
    ])
  })

  afterAll(async () => {
    if (createdAppNames.size > 0) {
      await db('apps').whereIn('name', Array.from(createdAppNames)).del()
    }
    await db('users').whereIn('id', [ADMIN.id, USER.id]).del()
    await closeDatabase()
  })

  afterEach(() => {
    currentUser = null
    authzFlag = false
    permitGrant = false
  })

  describe('POST /api/apps - Module Federation Apps', () => {
    it('registers a valid module federation app', async () => {
      const appData = {
        name: `Test MF App ${suffix}`,
        url: 'http://localhost:3000',
        iconUrl: 'http://localhost:3000/icon.svg',
        integrationType: 'module-federation',
        remoteUrl: 'http://localhost:3000/remoteEntry.js',
        scope: 'testApp',
        module: './App',
        description: 'A test module federation application',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(201)
      expect(response.body).toHaveProperty('id')
      expect(response.body.integrationType).toBe('module-federation')
      expect(response.body.remoteUrl).toBe(appData.remoteUrl)
      expect(response.body.scopeLevel).toBe('both')

      const row = await db('apps').where('id', response.body.id).first()
      expect(row.integration_type).toBe('module-federation')
      expect(row.scope_level).toBe('both')
    })

    it('rejects module federation app without remoteUrl', async () => {
      const response = await postApp({
        name: `Invalid MF App ${suffix}`,
        url: 'http://localhost:3003',
        integrationType: 'module-federation',
        scope: 'testApp',
        module: './App',
      })
      expect(response.status).toBe(400)
      expect(response.body.error).toContain('remoteUrl')
    })

    it('accepts an explicit scopeLevel', async () => {
      const response = await postApp({
        name: `Personal Scope App ${suffix}`,
        url: 'http://localhost:3010',
        integrationType: 'iframe',
        scopeLevel: 'personal',
      })
      expect(response.status).toBe(201)
      expect(response.body.scopeLevel).toBe('personal')
      const row = await db('apps').where('id', response.body.id).first()
      expect(row.scope_level).toBe('personal')
    })

    it('rejects an invalid scopeLevel', async () => {
      const response = await postApp({
        name: `Bad Scope App ${suffix}`,
        url: 'http://localhost:3011',
        integrationType: 'iframe',
        scopeLevel: 'nonsense',
      })
      expect(response.status).toBe(400)
      expect(response.body.error).toContain('scopeLevel')
    })
  })

  describe('POST /api/apps - Validation', () => {
    it('rejects app without name', async () => {
      const response = await postApp({
        url: 'http://localhost:7000',
        integrationType: 'iframe',
      })
      expect(response.status).toBe(400)
      expect(response.body.error).toContain('Name')
    })

    it('rejects invalid integration type', async () => {
      const response = await postApp({
        name: `Invalid Integration ${suffix}`,
        url: 'http://localhost:7001',
        integrationType: 'invalid-type',
      })
      expect(response.status).toBe(400)
      expect(response.body.error).toContain('Invalid integration type')
    })

    it('rejects duplicate app name', async () => {
      const appData = {
        name: `Duplicate App ${suffix}`,
        url: 'http://localhost:7002',
        integrationType: 'iframe',
      }
      const first = await postApp(appData)
      expect(first.status).toBe(201)

      const second = await postApp({ ...appData, url: 'http://localhost:7003' })
      expect(second.status).toBe(409)
      expect(second.body.error).toContain('exists')
    })

    it('rejects invalid URL format', async () => {
      const response = await postApp({
        name: `Invalid URL App ${suffix}`,
        url: 'not-a-valid-url',
        integrationType: 'iframe',
      })
      expect(response.status).toBe(400)
    })
  })

  describe('POST /api/apps - authentication & role', () => {
    it('rejects an unauthenticated request', async () => {
      currentUser = null
      const response = await request(app).post('/api/apps').send({
        name: `Unauth App ${suffix}`,
        url: 'http://localhost:8000',
        integrationType: 'iframe',
      })
      expect(response.status).toBe(401)
    })

    it('rejects a non-admin user with 403', async () => {
      const response = await postApp(
        {
          name: `Non Admin App ${suffix}`,
          url: 'http://localhost:8010',
          integrationType: 'iframe',
        },
        USER
      )
      expect(response.status).toBe(403)
      const row = await db('apps').where('name', `Non Admin App ${suffix}`).first()
      expect(row).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // appsec #100, flag OFF (default) — exact pre-fix parity. Every case here
  // documents the CURRENT (pre-fix) behavior this router ships with today.
  // ---------------------------------------------------------------------------
  describe('appsec #100 fix OFF (flag default — parity with pre-fix behavior)', () => {
    beforeEach(() => {
      authzFlag = false
    })

    it('GET / returns apps regardless of caller org (no read scoping)', async () => {
      const created = await postApp({
        name: `Unscoped Read App ${suffix}`,
        url: 'http://localhost:9000',
        integrationType: 'iframe',
      })
      expect(created.status).toBe(201)

      currentUser = USER // USER belongs to no organization at all
      const response = await request(app).get('/api/apps')
      expect(response.status).toBe(200)
      const names = response.body.map((a: any) => a.name)
      expect(names).toContain(`Unscoped Read App ${suffix}`)
    })

    it('POST /register succeeds with NO authentication (matches clock-app/task-manager-app)', async () => {
      currentUser = null
      const name = `Anon Register App ${suffix}`
      createdAppNames.add(name)
      const response = await request(app).post('/api/apps/register').send({
        name,
        url: 'http://localhost:9100',
        integrationType: 'iframe',
      })
      expect(response.status).toBe(201)
      expect(response.body.organizationId).toBeUndefined()

      const row = await db('apps').where('name', name).first()
      expect(row).toBeDefined()
      expect(row.organization_id).toBeNull()
    })

    it('POST /:id/heartbeat succeeds with NO authentication', async () => {
      const created = await postApp({
        name: `Heartbeat Open App ${suffix}`,
        url: 'http://localhost:9110',
        integrationType: 'iframe',
      })
      expect(created.status).toBe(201)

      currentUser = null
      const response = await request(app)
        .post(`/api/apps/${created.body.id}/heartbeat`)
        .send({ status: 'online' })
      expect(response.status).toBe(200)
    })

    it('PUT /:id/activate: any platform admin succeeds, even outside the app\'s org', async () => {
      const orgId = uuidv4()
      await db('organizations').insert({
        id: orgId,
        name: `Off-Flag Org ${suffix}`,
        slug: `off-flag-org-${suffix}`,
        owner_id: USER.id,
        type: 'organization',
      })
      const created = await postApp({
        name: `Cross Org Activate App ${suffix}`,
        url: 'http://localhost:9200',
        integrationType: 'iframe',
      })
      await db('apps')
        .where('id', created.body.id)
        .update({ organization_id: orgId })

      // ADMIN has no membership in orgId at all — pre-fix behavior still
      // allows it (bare platform-role check, not object-level).
      currentUser = ADMIN
      const response = await request(app)
        .put(`/api/apps/${created.body.id}/activate`)
        .send({ isActive: false })
      expect(response.status).toBe(200)

      await db('organizations').where('id', orgId).del()
    })
  })

  // ---------------------------------------------------------------------------
  // appsec #100, flag ON — the ported fix.
  // ---------------------------------------------------------------------------
  describe('appsec #100 fix ON (object-level authz)', () => {
    let orgId: string
    let outsideOrgId: string

    beforeAll(async () => {
      orgId = uuidv4()
      outsideOrgId = uuidv4()
      await db('organizations').insert([
        {
          id: orgId,
          name: `AuthZ Org ${suffix}`,
          slug: `authz-org-${suffix}`,
          owner_id: ADMIN.id,
          type: 'organization',
        },
        {
          id: outsideOrgId,
          name: `Outside Org ${suffix}`,
          slug: `outside-org-${suffix}`,
          owner_id: USER.id,
          type: 'organization',
        },
      ])
      await db('organization_memberships').insert([
        { user_id: ADMIN.id, organization_id: orgId, role: 'owner', status: 'active' },
        { user_id: USER.id, organization_id: outsideOrgId, role: 'owner', status: 'active' },
      ])
    })

    afterAll(async () => {
      await db('organization_memberships')
        .whereIn('organization_id', [orgId, outsideOrgId])
        .del()
      await db('apps').whereIn('organization_id', [orgId, outsideOrgId]).del()
      await db('organizations').whereIn('id', [orgId, outsideOrgId]).del()
    })

    beforeEach(() => {
      authzFlag = true
    })

    async function seedOwnedApp(
      name: string,
      visibility: 'private' | 'organization' | 'public' | 'marketplace' = 'organization'
    ): Promise<string> {
      const id = uuidv4()
      createdAppNames.add(name)
      await db('apps').insert({
        id,
        name,
        url: 'http://localhost:9300',
        integration_type: 'iframe',
        organization_id: orgId,
        visibility,
        is_active: true,
      })
      return id
    }

    it('GET / only returns apps the caller may see (org membership or public/marketplace)', async () => {
      const ownName = `Scoped Owned App ${suffix}`
      const outsideName = `Scoped Outside App ${suffix}`
      await seedOwnedApp(ownName, 'organization')
      const outsideId = uuidv4()
      createdAppNames.add(outsideName)
      await db('apps').insert({
        id: outsideId,
        name: outsideName,
        url: 'http://localhost:9301',
        integration_type: 'iframe',
        organization_id: outsideOrgId,
        visibility: 'private',
        is_active: true,
      })

      currentUser = ADMIN
      const response = await request(app).get('/api/apps')
      expect(response.status).toBe(200)
      const names = response.body.map((a: any) => a.name)
      expect(names).toContain(ownName)
      expect(names).not.toContain(outsideName)
    })

    it('POST /register requires authentication', async () => {
      currentUser = null
      const response = await request(app).post('/api/apps/register').send({
        name: `Auth Required Register App ${suffix}`,
        url: 'http://localhost:9400',
        integrationType: 'iframe',
      })
      expect(response.status).toBe(401)
    })

    it('POST /register binds the app to the caller\'s personal organization', async () => {
      const personalOrgId = uuidv4()
      await db('organizations').insert({
        id: personalOrgId,
        name: `Personal Org ${suffix}`,
        slug: `personal-org-${suffix}`,
        owner_id: USER.id,
        type: 'personal',
      })

      currentUser = USER
      permitGrant = true // App:create on the caller's own personal org, granted
      const name = `Personal Register App ${suffix}`
      createdAppNames.add(name)
      const response = await request(app).post('/api/apps/register').send({
        name,
        url: 'http://localhost:9410',
        integrationType: 'iframe',
      })
      expect(response.status).toBe(201)

      const row = await db('apps').where('name', name).first()
      expect(row.organization_id).toBe(personalOrgId)
      expect(row.visibility).toBe('private')

      await db('organizations').where('id', personalOrgId).del()
    })

    it("POST /register 400s when the caller has no personal organization", async () => {
      currentUser = ADMIN // ADMIN's only org above is type 'organization', not 'personal'
      const response = await request(app).post('/api/apps/register').send({
        name: `No Personal Org App ${suffix}`,
        url: 'http://localhost:9420',
        integrationType: 'iframe',
      })
      expect(response.status).toBe(400)
      expect(response.body.code).toBe('ORG_CONTEXT_REQUIRED')
    })

    it('POST /:id/heartbeat requires authentication', async () => {
      const appId = await seedOwnedApp(`Heartbeat AuthN App ${suffix}`)
      currentUser = null
      const response = await request(app)
        .post(`/api/apps/${appId}/heartbeat`)
        .send({ status: 'online' })
      expect(response.status).toBe(401)
    })

    it('POST /:id/heartbeat: non-member of the owning org gets 403', async () => {
      const appId = await seedOwnedApp(`Heartbeat NonMember App ${suffix}`)
      currentUser = USER // member of outsideOrgId, not orgId
      const response = await request(app)
        .post(`/api/apps/${appId}/heartbeat`)
        .send({ status: 'online' })
      expect(response.status).toBe(403)
    })

    it('POST /:id/heartbeat: owner of the app org succeeds and rejects an invalid status', async () => {
      const appId = await seedOwnedApp(`Heartbeat Owner App ${suffix}`)
      currentUser = ADMIN
      const ok = await request(app)
        .post(`/api/apps/${appId}/heartbeat`)
        .send({ status: 'online' })
      expect(ok.status).toBe(200)

      const bad = await request(app)
        .post(`/api/apps/${appId}/heartbeat`)
        .send({ status: 'not-a-real-status' })
      expect(bad.status).toBe(400)
    })

    it('PUT /:id/activate: owner of the app org gets 200', async () => {
      const appId = await seedOwnedApp(`Activate Owner App ${suffix}`)
      currentUser = ADMIN
      const response = await request(app)
        .put(`/api/apps/${appId}/activate`)
        .send({ isActive: false })
      expect(response.status).toBe(200)
      const row = await db('apps').where('id', appId).first()
      expect(Boolean(row.is_active)).toBe(false)
    })

    it('PUT /:id/activate: non-member gets 403, app left untouched', async () => {
      const appId = await seedOwnedApp(`Activate NonMember App ${suffix}`)
      currentUser = USER
      const response = await request(app)
        .put(`/api/apps/${appId}/activate`)
        .send({ isActive: false })
      expect(response.status).toBe(403)
      const row = await db('apps').where('id', appId).first()
      expect(Boolean(row.is_active)).toBe(true)
    })

    it('PUT /:id/activate: rejects non-boolean isActive', async () => {
      const appId = await seedOwnedApp(`Activate Coerce App ${suffix}`)
      currentUser = ADMIN
      const response = await request(app)
        .put(`/api/apps/${appId}/activate`)
        .send({ isActive: 'true' })
      expect(response.status).toBe(400)
    })

    it('PUT /:id/activate: org member (not owner/admin) is denied without a Permit grant, allowed with one', async () => {
      const appId = await seedOwnedApp(`Activate Permit App ${suffix}`)
      await db('organization_memberships').insert({
        user_id: USER.id,
        organization_id: orgId,
        role: 'member',
        status: 'active',
      })

      currentUser = USER
      permitGrant = false
      const denied = await request(app)
        .put(`/api/apps/${appId}/activate`)
        .send({ isActive: false })
      expect(denied.status).toBe(403)

      permitGrant = true
      const allowed = await request(app)
        .put(`/api/apps/${appId}/activate`)
        .send({ isActive: false })
      expect(allowed.status).toBe(200)

      await db('organization_memberships')
        .where({ user_id: USER.id, organization_id: orgId })
        .del()
    })

    it('DELETE /:id: non-member gets 403, owner gets 200', async () => {
      const appId = await seedOwnedApp(`Delete Flow App ${suffix}`)
      currentUser = USER
      await request(app).delete(`/api/apps/${appId}`).expect(403)

      currentUser = ADMIN
      const response = await request(app).delete(`/api/apps/${appId}`)
      expect(response.status).toBe(200)
      const row = await db('apps').where('id', appId).first()
      expect(row).toBeUndefined()
    })
  })
})
