import request from 'supertest'
import express from 'express'
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
})
