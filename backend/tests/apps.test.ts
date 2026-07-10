import request from 'supertest'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import appsRoutes from '../src/routes/apps'
import authRoutes from '../src/routes/auth'
import {
  initializeDatabaseConnection,
  db,
} from '../src/config/database'

// NOTE on harness design:
// The global harness (tests/setup.ts) waits for Postgres, ensures the test
// database exists, runs the REAL knex migrations and seeds. It does NOT,
// however, set the module-level `db` knex instance used by the routes/
// middleware under test. So here we call initializeDatabaseConnection() to
// point that shared `db` at the same (already-migrated/seeded) Postgres.
// We do NOT drop/recreate tables and we do NOT switch to SQLite.

// Build the app the same way src/index.ts wires the routes under test:
// a JSON body parser plus the real auth + apps routers (which themselves
// mount the real authenticateToken / requireRole middleware).
function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  app.use('/api/apps', appsRoutes)
  return app
}

describe('Apps Registration Routes', () => {
  let app: express.Application
  let authToken: string
  // Track app names we create so we can clean them out of the shared DB and
  // keep assertions about counts/contents deterministic.
  const createdAppNames = new Set<string>()

  // Helper: POST an app and remember its name for cleanup.
  async function postApp(appData: Record<string, any>, token = authToken) {
    if (appData && typeof appData.name === 'string') {
      createdAppNames.add(appData.name.trim())
    }
    return request(app)
      .post('/api/apps')
      .set('Authorization', `Bearer ${token}`)
      .send(appData)
  }

  beforeAll(async () => {
    // Point the shared module `db` at the migrated/seeded test Postgres.
    initializeDatabaseConnection()

    app = buildApp()

    // Obtain a REAL JWT via the REAL login route. The admin user is seeded by
    // the global setup (admin@fuzefront.dev / admin123 with roles admin,user).
    const loginResponse = await request(app).post('/api/auth/login').send({
      email: 'admin@fuzefront.dev',
      password: 'admin123',
    })

    expect(loginResponse.status).toBe(200)
    expect(loginResponse.body.token).toBeDefined()
    authToken = loginResponse.body.token
  })

  afterAll(async () => {
    // Remove only the rows this suite inserted; leave seeds intact for other
    // suites. The global afterAll closes the shared connection.
    if (createdAppNames.size > 0) {
      await db('apps').whereIn('name', Array.from(createdAppNames)).del()
    }
  })

  describe('POST /api/apps - Module Federation Apps', () => {
    it('should register a valid module federation app', async () => {
      const appData = {
        name: 'Test Module Federation App',
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
      expect(typeof response.body.id).toBe('string')
      expect(response.body.name).toBe(appData.name)
      expect(response.body.url).toBe(appData.url)
      expect(response.body.iconUrl).toBe(appData.iconUrl)
      expect(response.body.integrationType).toBe('module-federation')
      expect(response.body.remoteUrl).toBe(appData.remoteUrl)
      expect(response.body.scope).toBe(appData.scope)
      expect(response.body.module).toBe(appData.module)
      expect(response.body.description).toBe(appData.description)
      expect(response.body.isActive).toBe(true)

      // Side effect: the row is actually persisted with the mapped columns.
      const row = await db('apps').where('id', response.body.id).first()
      expect(row).toBeDefined()
      expect(row.name).toBe(appData.name)
      expect(row.integration_type).toBe('module-federation')
      expect(row.remote_url).toBe(appData.remoteUrl)
      expect(row.scope).toBe(appData.scope)
      expect(row.module).toBe(appData.module)
      expect(Boolean(row.is_active)).toBe(true)
    })

    it('should register module federation app with hyphenated integration type', async () => {
      const appData = {
        name: 'Test Hyphenated Module Federation',
        url: 'http://localhost:3001',
        iconUrl: 'http://localhost:3001/icon.svg',
        integrationType: 'module-federation', // hyphenated version
        remoteUrl: 'http://localhost:3001/remoteEntry.js',
        scope: 'testAppHyphen',
        module: './App',
        description: 'Testing hyphenated integration type',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(201)
      expect(response.body.integrationType).toBe('module-federation')
    })

    it('should reject module federation app without remoteUrl', async () => {
      const appData = {
        name: 'Invalid Module Federation App',
        url: 'http://localhost:3003',
        integrationType: 'module-federation',
        scope: 'testApp',
        module: './App',
        // remoteUrl missing
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('remoteUrl')

      // Side effect: nothing persisted.
      const row = await db('apps').where('name', appData.name).first()
      expect(row).toBeUndefined()
    })

    it('should reject module federation app without scope', async () => {
      const appData = {
        name: 'Invalid Module Federation App 2',
        url: 'http://localhost:3004',
        integrationType: 'module-federation',
        remoteUrl: 'http://localhost:3004/remoteEntry.js',
        module: './App',
        // scope missing
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('scope')
    })

    it('should reject module federation app without module', async () => {
      const appData = {
        name: 'Invalid Module Federation App 3',
        url: 'http://localhost:3005',
        integrationType: 'module-federation',
        remoteUrl: 'http://localhost:3005/remoteEntry.js',
        scope: 'testApp',
        // module missing
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('module')
    })
  })

  describe('POST /api/apps - Iframe Apps', () => {
    it('should register a valid iframe app', async () => {
      const appData = {
        name: 'Test Iframe App',
        url: 'http://localhost:4000',
        iconUrl: 'http://localhost:4000/icon.svg',
        integrationType: 'iframe',
        description: 'A test iframe application',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(201)

      expect(response.body).toHaveProperty('id')
      expect(response.body.name).toBe(appData.name)
      expect(response.body.url).toBe(appData.url)
      expect(response.body.integrationType).toBe('iframe')
      expect(response.body.isActive).toBe(true)

      const row = await db('apps').where('id', response.body.id).first()
      expect(row.integration_type).toBe('iframe')
    })

    it('should register iframe app without module federation specific fields', async () => {
      const appData = {
        name: 'Simple Iframe App',
        url: 'http://localhost:4001',
        integrationType: 'iframe',
        description: 'Simple iframe without optional fields',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(201)
      expect(response.body.integrationType).toBe('iframe')
      // The route returns these keys as undefined (omitted by JSON) when not
      // provided for an iframe app.
      expect(response.body.remoteUrl).toBeUndefined()
      expect(response.body.scope).toBeUndefined()
      expect(response.body.module).toBeUndefined()

      const row = await db('apps').where('id', response.body.id).first()
      expect(row.remote_url).toBeNull()
      expect(row.scope).toBeNull()
      expect(row.module).toBeNull()
    })
  })

  describe('POST /api/apps - Web Component Apps', () => {
    it('should register a valid web component app', async () => {
      const appData = {
        name: 'Test Web Component App',
        url: 'http://localhost:5000',
        iconUrl: 'http://localhost:5000/icon.svg',
        integrationType: 'web-component',
        description: 'A test web component application',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(201)
      expect(response.body).toHaveProperty('id')
      expect(response.body.name).toBe(appData.name)
      expect(response.body.url).toBe(appData.url)
      expect(response.body.integrationType).toBe('web-component')
      expect(response.body.isActive).toBe(true)
    })
  })

  describe('POST /api/apps - SPA Apps', () => {
    it('should register a valid SPA app', async () => {
      const appData = {
        name: 'Test SPA App',
        url: 'http://localhost:6000',
        iconUrl: 'http://localhost:6000/icon.svg',
        integrationType: 'spa',
        description: 'A test SPA application',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(201)
      expect(response.body).toHaveProperty('id')
      expect(response.body.name).toBe(appData.name)
      expect(response.body.url).toBe(appData.url)
      expect(response.body.integrationType).toBe('spa')
      expect(response.body.isActive).toBe(true)
    })
  })

  describe('POST /api/apps - Validation Tests', () => {
    it('should reject app without name', async () => {
      const appData = {
        url: 'http://localhost:7000',
        integrationType: 'iframe',
        // name missing
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
      // Route message: "Name is required and cannot be empty"
      expect(response.body.error).toContain('Name')
    })

    it('should reject app without url', async () => {
      const appData = {
        name: 'Test App Without URL',
        integrationType: 'iframe',
        // url missing
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
      // Route message: "URL is required and cannot be empty"
      expect(response.body.error).toContain('URL')
    })

    it('should reject app with invalid integration type', async () => {
      const appData = {
        name: 'Invalid Integration Type App',
        url: 'http://localhost:7001',
        integrationType: 'invalid-type',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('Invalid integration type')
    })

    it('should reject duplicate app name', async () => {
      const appData = {
        name: 'Duplicate App Name',
        url: 'http://localhost:7002',
        integrationType: 'iframe',
      }

      // Register first app
      const first = await postApp(appData)
      expect(first.status).toBe(201)

      // Try to register duplicate (different URL, same name)
      const response = await postApp({
        ...appData,
        url: 'http://localhost:7003',
      })
      expect(response.status).toBe(409)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('exists')

      // Side effect: only one row with that name persisted.
      const rows = await db('apps').where('name', appData.name)
      expect(rows.length).toBe(1)
    })

    it('should reject invalid URL format', async () => {
      const appData = {
        name: 'Invalid URL App',
        url: 'not-a-valid-url',
        integrationType: 'iframe',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('URL must be a valid')
    })

    it('should reject invalid icon URL format', async () => {
      const appData = {
        name: 'Invalid Icon URL App',
        url: 'http://localhost:7004',
        iconUrl: 'not-a-valid-url',
        integrationType: 'iframe',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('Icon URL must be a valid')
    })

    it('should reject extremely long app name', async () => {
      const appData = {
        name: 'A'.repeat(300), // exceeds 255 char limit
        url: 'http://localhost:7005',
        integrationType: 'iframe',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('too long')
    })

    it('should reject extremely long URL', async () => {
      const appData = {
        name: 'Long URL App',
        url: 'http://localhost:7006/' + 'a'.repeat(300),
        integrationType: 'iframe',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('too long')
    })
  })

  describe('POST /api/apps - Authentication & Authorization', () => {
    it('should reject request without authentication token', async () => {
      const appData = {
        name: 'Unauthenticated App',
        url: 'http://localhost:8000',
        integrationType: 'iframe',
      }

      const response = await request(app)
        .post('/api/apps')
        .send(appData)
        .expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Access denied. No token provided.')
    })

    it('should reject request with invalid token', async () => {
      const appData = {
        name: 'Invalid Token App',
        url: 'http://localhost:8001',
        integrationType: 'iframe',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', 'Bearer invalid-token')
        .send(appData)
        .expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Invalid token.')
    })

    it('should reject request with malformed Authorization header', async () => {
      const appData = {
        name: 'Malformed Auth App',
        url: 'http://localhost:8002',
        integrationType: 'iframe',
      }

      // No "Bearer <token>" -> split(' ')[1] is undefined -> "No token".
      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', 'InvalidFormat')
        .send(appData)
        .expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Access denied. No token provided.')
    })

    it('should reject a non-admin user with 403 (requireRole)', async () => {
      // Log in as the seeded demo user (roles: ['user'] only).
      const demoLogin = await request(app).post('/api/auth/login').send({
        email: 'demo@fuzefront.dev',
        password: 'demo123',
      })
      expect(demoLogin.status).toBe(200)
      const demoToken = demoLogin.body.token

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${demoToken}`)
        .send({
          name: 'Non Admin App',
          url: 'http://localhost:8010',
          integrationType: 'iframe',
        })
        .expect(403)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Insufficient permissions')

      // Side effect: nothing persisted for a forbidden request.
      const row = await db('apps').where('name', 'Non Admin App').first()
      expect(row).toBeUndefined()
    })
  })

  describe('POST /api/apps - Edge Cases', () => {
    it('should reject empty request body', async () => {
      const response = await postApp({})
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
    })

    it('should reject null values in required fields', async () => {
      const appData = {
        name: null,
        url: null,
        integrationType: 'iframe',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
    })

    it('should reject undefined values in required fields', async () => {
      const appData = {
        name: undefined,
        url: undefined,
        integrationType: 'iframe',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
    })

    it('should trim whitespace from string fields', async () => {
      const appData = {
        name: '  Whitespace Test App  ',
        url: '  http://localhost:8003  ',
        integrationType: 'iframe',
        description: '  Description with spaces  ',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(201)
      expect(response.body.name).toBe('Whitespace Test App')
      expect(response.body.url).toBe('http://localhost:8003')
      expect(response.body.description).toBe('Description with spaces')

      // Side effect: trimmed values persisted.
      const row = await db('apps').where('id', response.body.id).first()
      expect(row.name).toBe('Whitespace Test App')
      expect(row.url).toBe('http://localhost:8003')
    })

    it('should reject app with only whitespace in name', async () => {
      const appData = {
        name: '   ',
        url: 'http://localhost:8004',
        integrationType: 'iframe',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
    })

    it('should accept special characters in app name', async () => {
      const appData = {
        name: 'Test App with Special chars: éñümlëd & <script>',
        url: 'http://localhost:8005',
        integrationType: 'iframe',
      }

      const response = await postApp(appData)
      expect(response.status).toBe(201)
      expect(response.body.name).toBe(
        'Test App with Special chars: éñümlëd & <script>'
      )
    })
  })

  describe('GET /api/apps - Retrieve Apps', () => {
    const retrievalApps = [
      {
        name: 'Retrieval Test App 1',
        url: 'http://localhost:9000',
        integrationType: 'iframe',
      },
      {
        name: 'Retrieval Test App 2',
        url: 'http://localhost:9001',
        integrationType: 'module-federation',
        remoteUrl: 'http://localhost:9001/remoteEntry.js',
        scope: 'testScope',
        module: './App',
      },
    ]

    beforeAll(async () => {
      for (const appData of retrievalApps) {
        const res = await postApp(appData)
        expect(res.status).toBe(201)
        // GET /api/apps is now object-level scoped (org membership + visibility,
        // appsec HIGH-4). Apps created via POST /api/apps have no organization_id
        // and default to visibility 'private', so they are correctly excluded
        // from a non-member's listing. To assert the listing/shape behaviour we
        // mark these fixtures 'public' so the authenticated caller is entitled
        // to see them.
        await db('apps')
          .where('id', res.body.id)
          .update({ visibility: 'public' })
      }
    })

    it('should retrieve all apps with authentication', async () => {
      const response = await request(app)
        .get('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(Array.isArray(response.body)).toBe(true)
      expect(response.body.length).toBeGreaterThan(0)

      // Every returned app exposes the documented shape.
      response.body.forEach((a: any) => {
        expect(a).toHaveProperty('id')
        expect(a).toHaveProperty('name')
        expect(a).toHaveProperty('url')
        expect(a).toHaveProperty('integrationType')
        expect(a).toHaveProperty('isActive')
        expect(a).toHaveProperty('isHealthy')
      })

      // The apps we just created are actually present.
      const names = response.body.map((a: any) => a.name)
      expect(names).toContain('Retrieval Test App 1')
      expect(names).toContain('Retrieval Test App 2')

      // And their fields are mapped back correctly.
      const mf = response.body.find(
        (a: any) => a.name === 'Retrieval Test App 2'
      )
      expect(mf.integrationType).toBe('module-federation')
      expect(mf.remoteUrl).toBe('http://localhost:9001/remoteEntry.js')
      expect(mf.scope).toBe('testScope')
      expect(mf.module).toBe('./App')
    }, 30000)

    it('should reject unauthenticated request to get apps', async () => {
      const response = await request(app).get('/api/apps').expect(401)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Access denied. No token provided.')
    })
  })

  // ---------------------------------------------------------------------------
  // appsec #100: authentication on previously-OPEN routes (CRITICAL-1/2)
  // ---------------------------------------------------------------------------
  describe('Authentication on register/heartbeat (appsec #100)', () => {
    it('POST /api/apps/register requires authentication (was open)', async () => {
      const response = await request(app)
        .post('/api/apps/register')
        .send({
          name: 'Anon Self Register',
          url: 'http://localhost:9100',
          integrationType: 'iframe',
        })
        .expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Access denied. No token provided.')

      // Side effect: nothing was injected into the registry.
      const row = await db('apps').where('name', 'Anon Self Register').first()
      expect(row).toBeUndefined()
    })

    it('POST /api/apps/:id/heartbeat requires authentication (was open)', async () => {
      const response = await request(app)
        .post(`/api/apps/${'00000000-0000-0000-0000-000000000000'}/heartbeat`)
        .send({ status: 'online' })
        .expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Access denied. No token provided.')
    })
  })

  // ---------------------------------------------------------------------------
  // appsec #100: object-level authorization on app mutations (HIGH-3)
  //
  // Replaces the old global requireRole(['admin']) on activate/delete with an
  // object-level check against the app's owning organization. We seed an org +
  // owner membership for the seeded admin user and an app owned by that org,
  // then assert: owner -> 200, non-member -> 403. This exercises the
  // membership-table path of requireAppAction deterministically (no Permit PDP
  // dependency).
  // ---------------------------------------------------------------------------
  describe('Object-level authz on activate/delete (appsec #100)', () => {
    const ADMIN_USER_ID = '8dbf6a1b-c0a1-462a-9bf5-934c8c7339c3'
    let orgId: string
    let demoToken: string

    beforeAll(async () => {
      // A non-owner caller: the seeded demo user (roles: ['user']).
      const demoLogin = await request(app).post('/api/auth/login').send({
        email: 'demo@fuzefront.dev',
        password: 'demo123',
      })
      expect(demoLogin.status).toBe(200)
      demoToken = demoLogin.body.token

      // Seed an organization owned by the admin user with an active 'owner'
      // membership, so the admin is an object-level owner of its apps.
      orgId = uuidv4()
      await db('organizations').insert({
        id: orgId,
        name: 'AuthZ Test Org',
        slug: `authz-test-org-${orgId.slice(0, 8)}`,
        owner_id: ADMIN_USER_ID,
        type: 'organization',
        settings: JSON.stringify({}),
        metadata: JSON.stringify({}),
        is_active: true,
      })
      await db('organization_memberships').insert({
        id: uuidv4(),
        user_id: ADMIN_USER_ID,
        organization_id: orgId,
        role: 'owner',
        status: 'active',
        joined_at: new Date(),
        permissions: JSON.stringify({}),
        metadata: JSON.stringify({}),
      })
    })

    afterAll(async () => {
      await db('organization_memberships')
        .where('organization_id', orgId)
        .del()
      await db('apps').where('organization_id', orgId).del()
      await db('organizations').where('id', orgId).del()
    })

    // Helper: insert an org-owned app directly and remember it for cleanup.
    async function seedOwnedApp(name: string): Promise<string> {
      const id = uuidv4()
      createdAppNames.add(name)
      await db('apps').insert({
        id,
        name,
        url: 'http://localhost:9200',
        integration_type: 'iframe',
        organization_id: orgId,
        visibility: 'organization',
        is_active: true,
      })
      return id
    }

    it('PUT /:id/activate: owner of the app org gets 200', async () => {
      const appId = await seedOwnedApp('AuthZ Owned Activate App')

      const response = await request(app)
        .put(`/api/apps/${appId}/activate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ isActive: false })
        .expect(200)

      expect(response.body.message).toBe('App status updated successfully')
      const row = await db('apps').where('id', appId).first()
      expect(Boolean(row.is_active)).toBe(false)
    })

    it('PUT /:id/activate: non-member gets 403 (no cross-tenant mutation)', async () => {
      const appId = await seedOwnedApp('AuthZ NonOwner Activate App')

      const response = await request(app)
        .put(`/api/apps/${appId}/activate`)
        .set('Authorization', `Bearer ${demoToken}`)
        .send({ isActive: false })
        .expect(403)

      expect(response.body).toHaveProperty('error')
      // Side effect: app left untouched (still active).
      const row = await db('apps').where('id', appId).first()
      expect(Boolean(row.is_active)).toBe(true)
    })

    it('PUT /:id/activate: rejects non-boolean isActive (mass-assign guard)', async () => {
      const appId = await seedOwnedApp('AuthZ Activate Coerce App')

      const response = await request(app)
        .put(`/api/apps/${appId}/activate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ isActive: 'true' })
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })

    it('DELETE /:id: non-member gets 403, app not deleted', async () => {
      const appId = await seedOwnedApp('AuthZ NonOwner Delete App')

      await request(app)
        .delete(`/api/apps/${appId}`)
        .set('Authorization', `Bearer ${demoToken}`)
        .expect(403)

      const row = await db('apps').where('id', appId).first()
      expect(row).toBeDefined()
    })

    it('DELETE /:id: owner gets 200 and the app is removed', async () => {
      const appId = await seedOwnedApp('AuthZ Owner Delete App')

      const response = await request(app)
        .delete(`/api/apps/${appId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.message).toBe('App deleted successfully')
      const row = await db('apps').where('id', appId).first()
      expect(row).toBeUndefined()
    })

    it('DELETE /:id: requires authentication', async () => {
      const appId = await seedOwnedApp('AuthZ Unauth Delete App')

      await request(app).delete(`/api/apps/${appId}`).expect(401)

      const row = await db('apps').where('id', appId).first()
      expect(row).toBeDefined()
    })
  })

  // ---------------------------------------------------------------------------
  // appsec #100: object-level authorization on POST /api/apps/register
  //
  // /register is now authenticateToken + requireAppPermission('create'). Because
  // the route carries no :organizationId and authenticateToken sets none on
  // req.user, the middleware resolves the caller's SINGLE active org membership
  // and grants 'create' object-level when the caller is owner/admin of that org;
  // it fails closed when the membership is ambiguous (multiple) or absent, and
  // defers to the Permit policy check for non-owner/admin members (which the CI
  // no-op proxy denies -> 403). Org is bound from the verified context, never
  // from req.body (no tenant spoofing). bcrypt is required lazily to avoid an
  // import-order surprise; uuid + db are already imported above.
  // ---------------------------------------------------------------------------
  describe('Object-level authz on POST /api/apps/register (appsec #100)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bcrypt = require('bcrypt')
    // drainProvisioningQueue lets us await the fire-and-forget personal-org
    // self-heal that login() kicks off, so membership state is deterministic
    // (not racing a background provision) before we normalize it per scenario.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { drainProvisioningQueue } = require('../src/routes/auth')

    // Fresh users with roles: ['user'] only — so any 'create' grant comes from
    // an org owner/admin MEMBERSHIP (resolveCallerOrgMembership), never from a
    // platform admin role.
    const ownerUserId = uuidv4()
    const ownerEmail = `reg-owner-${ownerUserId.slice(0, 8)}@fuzefront.test`
    const memberUserId = uuidv4()
    const memberEmail = `reg-member-${memberUserId.slice(0, 8)}@fuzefront.test`
    const multiUserId = uuidv4()
    const multiEmail = `reg-multi-${multiUserId.slice(0, 8)}@fuzefront.test`

    // Orgs we create so we can normalize each user's membership to an exact
    // known state. Tracked for cleanup.
    let ownerOrgId: string
    let memberOrgId: string
    let multiOrgA: string
    let multiOrgB: string
    let otherOrgId: string // an org the owner does NOT belong to
    const trackedOrgIds: string[] = []
    const allUserIds = [ownerUserId, memberUserId, multiUserId]

    let ownerToken: string
    let memberToken: string
    let multiToken: string

    async function makeUser(id: string, email: string) {
      await db('users').insert({
        id,
        email,
        password_hash: await bcrypt.hash('pw123456', 10), // nosemgrep: fuze-auth-local-password-store
        first_name: 'Reg',
        last_name: 'Test',
        roles: JSON.stringify(['user']),
      })
    }

    async function makeOrg(ownerId: string, name: string): Promise<string> {
      const id = uuidv4()
      await db('organizations').insert({
        id,
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(0, 8)}`,
        owner_id: ownerId,
        type: 'organization',
        settings: JSON.stringify({}),
        metadata: JSON.stringify({}),
        is_active: true,
      })
      trackedOrgIds.push(id)
      return id
    }

    async function addMembership(userId: string, orgId: string, role: string) {
      await db('organization_memberships').insert({
        id: uuidv4(),
        user_id: userId,
        organization_id: orgId,
        role,
        status: 'active',
        joined_at: new Date(),
        permissions: JSON.stringify({}),
        metadata: JSON.stringify({}),
      })
    }

    // Reset a user's active memberships to EXACTLY the given (orgId, role) set.
    // login() triggers a background personal-org self-heal; we drain it, then
    // overwrite memberships so each scenario's membership cardinality/role is
    // deterministic regardless of provisioning timing.
    async function setMemberships(
      userId: string,
      memberships: Array<{ orgId: string; role: string }>
    ) {
      await db('organization_memberships').where('user_id', userId).del()
      for (const m of memberships) await addMembership(userId, m.orgId, m.role)
    }

    async function login(email: string): Promise<string> {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'pw123456' })
      expect(res.status).toBe(200)
      return res.body.token
    }

    beforeAll(async () => {
      await makeUser(ownerUserId, ownerEmail)
      await makeUser(memberUserId, memberEmail)
      await makeUser(multiUserId, multiEmail)

      ownerOrgId = await makeOrg(ownerUserId, 'Reg Owner Org')
      memberOrgId = await makeOrg(memberUserId, 'Reg Member Org')
      multiOrgA = await makeOrg(multiUserId, 'Reg Multi Org A')
      multiOrgB = await makeOrg(multiUserId, 'Reg Multi Org B')
      otherOrgId = await makeOrg(ownerUserId, 'Reg Other Org') // owner not a member

      ownerToken = await login(ownerEmail)
      memberToken = await login(memberEmail)
      multiToken = await login(multiEmail)

      // Wait for the login self-heal personal-org provisioning to settle, THEN
      // pin each user to an exact membership state.
      await drainProvisioningQueue()
      // Owner: exactly one active OWNER membership (object-level grant path).
      await setMemberships(ownerUserId, [{ orgId: ownerOrgId, role: 'owner' }])
      // Member: exactly one active MEMBER membership (defer-to-Permit path).
      await setMemberships(memberUserId, [
        { orgId: memberOrgId, role: 'member' },
      ])
      // Multi: two active memberships → ambiguous → fail closed.
      await setMemberships(multiUserId, [
        { orgId: multiOrgA, role: 'owner' },
        { orgId: multiOrgB, role: 'owner' },
      ])
    })

    afterAll(async () => {
      // Drain again so no in-flight provision touches rows mid-cleanup.
      await drainProvisioningQueue().catch(() => undefined)
      if (trackedOrgIds.length > 0) {
        await db('apps').whereIn('organization_id', trackedOrgIds).del()
      }
      await db('organization_memberships').whereIn('user_id', allUserIds).del()
      if (trackedOrgIds.length > 0) {
        await db('organizations').whereIn('id', trackedOrgIds).del()
      }
      // Also remove any personal org the self-heal created for these users.
      await db('organizations').whereIn('owner_id', allUserIds).del()
      await db('users').whereIn('id', allUserIds).del()
    })

    it('(a) single-membership owner → 201, app created under the resolved org', async () => {
      const name = 'Reg Owner Single Membership App'
      createdAppNames.add(name)
      const response = await request(app)
        .post('/api/apps/register')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name,
          url: 'http://localhost:9300',
          integrationType: 'module-federation',
          remoteUrl: 'http://localhost:9300/assets',
          scope: 'regOwner',
          module: './App',
        })
        .expect(201)

      expect(response.body).toHaveProperty('id')
      const row = await db('apps').where('id', response.body.id).first()
      expect(row).toBeDefined()
      // The app is bound to the caller's resolved org, not anything from body.
      expect(row.organization_id).toBe(ownerOrgId)
      expect(row.visibility).toBe('private')
    })

    it('(b) multi-membership caller with no org context → 400 fail closed', async () => {
      const name = 'Reg Multi Membership App'
      const response = await request(app)
        .post('/api/apps/register')
        .set('Authorization', `Bearer ${multiToken}`)
        .send({
          name,
          url: 'http://localhost:9301',
          integrationType: 'iframe',
        })
        .expect(400)

      expect(response.body.code).toBe('ORG_CONTEXT_REQUIRED')
      // Side effect: nothing persisted under either ambiguous org.
      const row = await db('apps').where('name', name).first()
      expect(row).toBeUndefined()
    })

    it('(c) plain member (not owner/admin), Permit no-op denies → 403', async () => {
      const name = 'Reg Member Denied App'
      const response = await request(app)
        .post('/api/apps/register')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          name,
          url: 'http://localhost:9302',
          integrationType: 'iframe',
        })
        .expect(403)

      expect(response.body.code).toBe('APP_PERMISSION_DENIED')
      const row = await db('apps').where('name', name).first()
      expect(row).toBeUndefined()
    })

    it('(d) req.body.organizationId is ignored — app lands in the caller resolved org', async () => {
      const name = 'Reg Body Org Spoof App'
      createdAppNames.add(name)
      const response = await request(app)
        .post('/api/apps/register')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name,
          url: 'http://localhost:9303',
          integrationType: 'iframe',
          // Attempt to plant the app in an org the caller does not belong to.
          organizationId: otherOrgId,
        })
        .expect(201)

      const row = await db('apps').where('id', response.body.id).first()
      // Bound to the caller's verified org, NOT the body-supplied otherOrgId.
      expect(row.organization_id).toBe(ownerOrgId)
      expect(row.organization_id).not.toBe(otherOrgId)
    })

    it('register still requires authentication (was open before #100)', async () => {
      await request(app)
        .post('/api/apps/register')
        .send({
          name: 'Reg Anon App',
          url: 'http://localhost:9304',
          integrationType: 'iframe',
        })
        .expect(401)
      const row = await db('apps').where('name', 'Reg Anon App').first()
      expect(row).toBeUndefined()
    })
  })
})
