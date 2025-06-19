import request from 'supertest'
import express from 'express'
import appsRoutes from '../src/routes/apps'
import authRoutes from '../src/routes/auth'
import { db } from '../src/config/database'

describe('Apps Registration Routes', () => {
  let app: express.Application
  let authToken: string

  beforeAll(async () => {
    // Create test app
    app = express()
    app.use(express.json())
    app.use('/api/auth', authRoutes)
    app.use('/api/apps', appsRoutes)

    // Set environment for SQLite testing
    process.env.NODE_ENV = 'test'
    process.env.USE_POSTGRES = 'false'
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only'

    // Create test tables directly without migrations
    await db.schema.dropTableIfExists('sessions')
    await db.schema.dropTableIfExists('apps')
    await db.schema.dropTableIfExists('users')

    // Create users table
    await db.schema.createTable('users', table => {
      table.string('id').primary()
      table.string('email').unique().notNullable()
      table.string('password_hash')
      table.string('first_name')
      table.string('last_name')
      table.string('default_app_id')
      table.text('roles').defaultTo('["user"]') // Use text instead of json for SQLite
      table.timestamps(true, true)
    })

    // Create apps table
    await db.schema.createTable('apps', table => {
      table.string('id').primary()
      table.string('name').notNullable().unique()
      table.string('url').notNullable()
      table.string('icon_url')
      table.boolean('is_active').defaultTo(true)
      table.string('integration_type').defaultTo('iframe')
      table.string('remote_url')
      table.string('scope')
      table.string('module')
      table.text('description')
      table.text('metadata')
      table.timestamps(true, true)
    })

    // Create sessions table
    await db.schema.createTable('sessions', table => {
      table.string('id').primary()
      table.string('user_id').notNullable()
      table.string('tenant_id')
      table.timestamp('expires_at').notNullable()
      table.timestamps(true, true)
      table.foreign('user_id').references('users.id')
    })

    // Seed test user
    const bcrypt = require('bcrypt')
    const adminPasswordHash = await bcrypt.hash('admin123', 10)
    await db('users').insert({
      id: '8dbf6a1b-c0a1-462a-9bf5-934c8c7339c3',
      email: 'admin@fuzefront.dev',
      password_hash: adminPasswordHash,
      first_name: 'Admin',
      last_name: 'User',
      roles: JSON.stringify(['admin', 'user']), // Store as JSON string for SQLite
      created_at: new Date(),
      updated_at: new Date(),
    })

    // Get authentication token
    const loginResponse = await request(app).post('/api/auth/login').send({
      email: 'admin@fuzefront.dev',
      password: 'admin123',
    })

    authToken = loginResponse.body.token
  })

  afterAll(async () => {
    // Clean up database connection
    await db.destroy()
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

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(201)

      expect(response.body).toHaveProperty('id')
      expect(response.body.name).toBe(appData.name)
      expect(response.body.url).toBe(appData.url)
      expect(response.body.integrationType).toBe('module-federation')
      expect(response.body.remoteUrl).toBe(appData.remoteUrl)
      expect(response.body.scope).toBe(appData.scope)
      expect(response.body.module).toBe(appData.module)
      expect(response.body.isActive).toBe(true)
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

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(201)

      expect(response.body.integrationType).toBe('module-federation')
    })

    it('should register module federation app with underscore integration type', async () => {
      const appData = {
        name: 'Test Underscore Module Federation',
        url: 'http://localhost:3002',
        iconUrl: 'http://localhost:3002/icon.svg',
        integrationType: 'module_federation', // underscore version
        remoteUrl: 'http://localhost:3002/remoteEntry.js',
        scope: 'testAppUnderscore',
        module: './App',
        description: 'Testing underscore integration type',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(201)

      expect(response.body.integrationType).toBe('module_federation')
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

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('remoteUrl')
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

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

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

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

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

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(201)

      expect(response.body).toHaveProperty('id')
      expect(response.body.name).toBe(appData.name)
      expect(response.body.url).toBe(appData.url)
      expect(response.body.integrationType).toBe('iframe')
      expect(response.body.isActive).toBe(true)
    })

    it('should register iframe app without module federation specific fields', async () => {
      const appData = {
        name: 'Simple Iframe App',
        url: 'http://localhost:4001',
        integrationType: 'iframe',
        description: 'Simple iframe without optional fields',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(201)

      expect(response.body.integrationType).toBe('iframe')
      expect(response.body.remoteUrl).toBeUndefined()
      expect(response.body.scope).toBeUndefined()
      expect(response.body.module).toBeUndefined()
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

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(201)

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

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(201)

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

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('Name')
    })

    it('should reject app without url', async () => {
      const appData = {
        name: 'Test App Without URL',
        integrationType: 'iframe',
        // url missing
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('URL')
    })

    it('should reject app with invalid integration type', async () => {
      const appData = {
        name: 'Invalid Integration Type App',
        url: 'http://localhost:7001',
        integrationType: 'invalid-type',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })

    it('should reject duplicate app name', async () => {
      const appData = {
        name: 'Duplicate App Name',
        url: 'http://localhost:7002',
        integrationType: 'iframe',
      }

      // Register first app
      await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(201)

      // Try to register duplicate
      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...appData,
          url: 'http://localhost:7003', // different URL but same name
        })
        .expect(409)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('exists')
    })

    it('should reject invalid URL format', async () => {
      const appData = {
        name: 'Invalid URL App',
        url: 'not-a-valid-url',
        integrationType: 'iframe',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })

    it('should reject invalid icon URL format', async () => {
      const appData = {
        name: 'Invalid Icon URL App',
        url: 'http://localhost:7004',
        iconUrl: 'not-a-valid-url',
        integrationType: 'iframe',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })

    it('should reject extremely long app name', async () => {
      const appData = {
        name: 'A'.repeat(300), // Very long name
        url: 'http://localhost:7005',
        integrationType: 'iframe',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })

    it('should reject extremely long URL', async () => {
      const appData = {
        name: 'Long URL App',
        url: 'http://localhost:7006/' + 'a'.repeat(300),
        integrationType: 'iframe',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })
  })

  describe('POST /api/apps - Authentication Tests', () => {
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

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', 'InvalidFormat')
        .send(appData)
        .expect(401)

      expect(response.body).toHaveProperty('error')
    })
  })

  describe('POST /api/apps - Edge Cases', () => {
    it('should handle empty request body', async () => {
      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })

    it('should handle null values in required fields', async () => {
      const appData = {
        name: null,
        url: null,
        integrationType: 'iframe',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })

    it('should handle undefined values in required fields', async () => {
      const appData = {
        name: undefined,
        url: undefined,
        integrationType: 'iframe',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })

    it('should trim whitespace from string fields', async () => {
      const appData = {
        name: '  Whitespace Test App  ',
        url: '  http://localhost:8003  ',
        integrationType: 'iframe',
        description: '  Description with spaces  ',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(201)

      expect(response.body.name).toBe('Whitespace Test App')
      expect(response.body.url).toBe('http://localhost:8003')
      expect(response.body.description).toBe('Description with spaces')
    })

    it('should reject app with only whitespace in name', async () => {
      const appData = {
        name: '   ',
        url: 'http://localhost:8004',
        integrationType: 'iframe',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })

    it('should handle special characters in app name', async () => {
      const appData = {
        name: 'Test App with Special chars: éñümlëd & <script>',
        url: 'http://localhost:8005',
        integrationType: 'iframe',
      }

      const response = await request(app)
        .post('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .send(appData)
        .expect(201)

      expect(response.body.name).toBe(
        'Test App with Special chars: éñümlëd & <script>'
      )
    })
  })

  describe('GET /api/apps - Retrieve Apps', () => {
    beforeAll(async () => {
      // Create some test apps for retrieval tests
      const testApps = [
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

      for (const appData of testApps) {
        await request(app)
          .post('/api/apps')
          .set('Authorization', `Bearer ${authToken}`)
          .send(appData)
      }
    })

    it('should retrieve all apps with authentication', async () => {
      const response = await request(app)
        .get('/api/apps')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(Array.isArray(response.body)).toBe(true)
      expect(response.body.length).toBeGreaterThan(0)

      // Check that each app has required properties
      response.body.forEach((app: any) => {
        expect(app).toHaveProperty('id')
        expect(app).toHaveProperty('name')
        expect(app).toHaveProperty('url')
        expect(app).toHaveProperty('integrationType')
        expect(app).toHaveProperty('isActive')
        expect(app).toHaveProperty('isHealthy')
      })
    })

    it('should reject unauthenticated request to get apps', async () => {
      const response = await request(app).get('/api/apps').expect(401)

      expect(response.body).toHaveProperty('error')
    })
  })
})
