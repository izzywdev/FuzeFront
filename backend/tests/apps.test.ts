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
        // GET /api/apps is object-level scoped (org membership + visibility,
        // appsec HIGH-4; see scopeAppsQuery). Mark these fixtures 'public'
        // regardless of what the org/visibility scoping would otherwise do,
        // so this suite asserts the listing/shape behaviour independent of
        // that scoping (which has its own dedicated coverage below).
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
  // portal-registration-gap: scopeAppsQuery must agree with the production
  // app-registry visibility rule (backend/applications/src/app-registry/
  // service.ts `list()`), not the pre-fix version of itself, AND
  // `apps.organization_id` must actually be impossible to leave null.
  //
  // Owner ruling 2026-08-25 superseded the original "reconcile the two
  // org-less branches" framing: an org-less app is not a state to be
  // handled by either query, it is a state the schema must no longer allow
  // ("there should be no app without orgid ... fuzefront itself [is] the
  // orgid for our own apps"). So this suite tests the CONSTRAINT, not a
  // null-organization_id code path — "it passes on the current data" is not
  // evidence a NOT NULL migration actually did anything.
  // ---------------------------------------------------------------------------
  describe('GET /api/apps - visibility/org scoping parity, and apps.organization_id NOT NULL', () => {
    const ADMIN_USER_ID = '8dbf6a1b-c0a1-462a-9bf5-934c8c7339c3'
    let scopedOrgId: string
    let otherOrgId: string
    let demoToken: string
    let ownOrgAppId: string
    let otherOrgAppId: string

    beforeAll(async () => {
      // A non-owner, non-member caller for the "does NOT belong to this org"
      // assertions: the seeded demo user (roles: ['user']).
      const demoLogin = await request(app).post('/api/auth/login').send({
        email: 'demo@fuzefront.dev',
        password: 'demo123',
      })
      expect(demoLogin.status).toBe(200)
      demoToken = demoLogin.body.token

      // An org the admin (authToken) IS an active member of.
      scopedOrgId = uuidv4()
      await db('organizations').insert({
        id: scopedOrgId,
        name: 'Visibility Parity Org',
        slug: `visibility-parity-org-${scopedOrgId.slice(0, 8)}`,
        owner_id: ADMIN_USER_ID,
        type: 'organization',
        settings: JSON.stringify({}),
        metadata: JSON.stringify({}),
        is_active: true,
      })
      await db('organization_memberships').insert({
        id: uuidv4(),
        user_id: ADMIN_USER_ID,
        organization_id: scopedOrgId,
        role: 'owner',
        status: 'active',
        joined_at: new Date(),
        permissions: JSON.stringify({}),
        metadata: JSON.stringify({}),
      })

      // An org NEITHER caller belongs to, for the BOLA-exclusion assertion.
      // The row must EXIST: `apps.organization_id` carries the FK
      // `apps_organization_id_foreign`, so referencing an org that was never
      // inserted aborts this beforeAll and fails every test in the block. What
      // makes it a "does not belong" org is the absence of an
      // organization_memberships row below, not the absence of the org itself.
      otherOrgId = uuidv4()
      await db('organizations').insert({
        id: otherOrgId,
        name: 'Visibility Parity Other Org',
        slug: `visibility-parity-other-org-${otherOrgId.slice(0, 8)}`,
        owner_id: ADMIN_USER_ID,
        type: 'organization',
        settings: JSON.stringify({}),
        metadata: JSON.stringify({}),
        is_active: true,
      })

      // Case 1: 'organization' visibility, owned by an org the admin belongs to.
      ownOrgAppId = uuidv4()
      createdAppNames.add('Parity Own-Org App')
      await db('apps').insert({
        id: ownOrgAppId,
        name: 'Parity Own-Org App',
        url: 'http://localhost:9301',
        integration_type: 'iframe',
        organization_id: scopedOrgId,
        visibility: 'organization',
        is_active: true,
      })

      // Case 2: 'organization' visibility, owned by a DIFFERENT org neither
      // caller belongs to -- must stay excluded for both (BOLA).
      otherOrgAppId = uuidv4()
      createdAppNames.add('Parity Other-Org App')
      await db('apps').insert({
        id: otherOrgAppId,
        name: 'Parity Other-Org App',
        url: 'http://localhost:9302',
        integration_type: 'iframe',
        organization_id: otherOrgId,
        visibility: 'organization',
        is_active: true,
      })
    })

    afterAll(async () => {
      await db('organization_memberships')
        .where('organization_id', scopedOrgId)
        .del()
      await db('apps').whereIn('id', [ownOrgAppId, otherOrgAppId]).del()
      // Both orgs, and only after the apps that reference them are gone —
      // apps.organization_id has no ON DELETE, so the reverse order fails.
      await db('organizations').whereIn('id', [scopedOrgId, otherOrgId]).del()
    })

    it("shows an 'organization'-visibility app to a member of that org", async () => {
      const response = await request(app)
        .get('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      const names = response.body.map((a: any) => a.name)
      expect(names).toContain('Parity Own-Org App')
    })

    it("excludes an 'organization'-visibility app of an org the caller does not belong to (BOLA)", async () => {
      const response = await request(app)
        .get('/api/apps')
        .set('Authorization', `Bearer ${demoToken}`)
        .expect(200)
      const names = response.body.map((a: any) => a.name)
      expect(names).not.toContain('Parity Own-Org App')
      expect(names).not.toContain('Parity Other-Org App')
    })

    it('rejects an INSERT with organization_id explicitly NULL (026_apps_organization_id_not_null)', async () => {
      // Not "does the app show up right" — a direct assertion that the
      // constraint itself is live, so a future change cannot silently drop
      // it and only be caught by a data audit months later.
      await expect(
        db('apps').insert({
          id: uuidv4(),
          name: 'Constraint Probe — should never be visible or exist',
          url: 'http://localhost:9399',
          integration_type: 'iframe',
          organization_id: null,
          visibility: 'private',
          is_active: false,
        })
      ).rejects.toThrow(/organization_id|not-null|null value/i)
    })

    it('omitting organization_id on INSERT falls back to the column DEFAULT (the platform root org), not NULL', async () => {
      const ROOT_ORG_ID = '00000000-0000-0000-0000-000000000010'
      const id = uuidv4()
      createdAppNames.add('Parity Default-Org App')
      await db('apps').insert({
        id,
        name: 'Parity Default-Org App',
        url: 'http://localhost:9303',
        integration_type: 'iframe',
        // organization_id deliberately omitted.
        visibility: 'private',
        is_active: true,
      })
      const row = await db('apps').where({ id }).first()
      expect(row.organization_id).toBe(ROOT_ORG_ID)
      await db('apps').where({ id }).del()
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
})
