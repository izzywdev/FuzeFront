import request from 'supertest'
import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import authRoutes from '../src/routes/auth'
import { initializeDatabase, db } from '../src/config/database'

const JWT_REGEX = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/

// Seeded admin (see src/seeds/001_initial_users.ts). The legacy version of
// this suite used admin@frontfuse.dev, which is NOT what the seeds create.
const ADMIN_EMAIL = 'admin@fuzefront.dev'
const ADMIN_PASSWORD = 'admin123'

// CORS origins mirror the real src/index.ts wiring for the values asserted here.
const ALLOWED_ORIGIN = 'http://localhost:8085'

/**
 * Mirror the relevant src/index.ts wiring (cors + json + the real auth router)
 * so CORS/auth behavior is the genuine app behavior. Runs against the real
 * Postgres test DB prepared by tests/setup.ts (migrated + seeded). No tables
 * are recreated and SQLite is never used.
 */
function buildApp(): express.Application {
  const app = express()
  app.use(
    cors({
      origin: [ALLOWED_ORIGIN, 'http://localhost:5173'],
      credentials: true,
    })
  )
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  return app
}

describe('Authentication - Real Postgres Integration Tests', () => {
  let app: express.Application

  beforeAll(async () => {
    // Populate the module-level `db` the routes/middleware import.
    await initializeDatabase()
    // Sanity check the connection up front.
    await db.raw('SELECT 1')
    app = buildApp()
  })

  // The shared `db` is destroyed once by tests/setup.ts's global afterAll.
  // Do not destroy it here.

  afterEach(async () => {
    // Clean up any sessions created for the admin during a test.
    const admin = await db('users').where('email', ADMIN_EMAIL).first()
    if (admin) await db('sessions').where('user_id', admin.id).del()
  })

  describe('Database Connectivity', () => {
    it('should connect to the database', async () => {
      const result = await db.raw('SELECT 1 as test')
      expect(result).toBeDefined()
      expect(Number(result.rows[0].test)).toBe(1)
    })

    it('should have a users table containing the seeded admin user', async () => {
      const adminUser = await db('users').where('email', ADMIN_EMAIL).first()
      expect(adminUser).toBeDefined()
      expect(adminUser.email).toBe(ADMIN_EMAIL)
      expect(adminUser.password_hash).toBeTruthy()
    })

    it('should have a sessions table', async () => {
      const tableExists = await db.schema.hasTable('sessions')
      expect(tableExists).toBe(true)
    })
  })

  describe('POST /api/auth/login', () => {
    it('should login with valid admin credentials and persist a session', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .expect(200)

      expect(response.body).toHaveProperty('token')
      expect(response.body).toHaveProperty('user')
      expect(response.body).toHaveProperty('sessionId')
      expect(response.body.token).toMatch(JWT_REGEX)
      expect(response.body.user.email).toBe(ADMIN_EMAIL)
      expect(response.body.user.roles).toContain('admin')

      const session = await db('sessions')
        .where('id', response.body.sessionId)
        .first()
      expect(session).toBeDefined()
      expect(session.user_id).toBe(response.body.user.id)
    })

    it('should reject invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: 'wrongpassword' })
        .expect(401)
      expect(response.body.error).toBe('Invalid credentials')
    })

    it('should reject non-existent user', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'password123' })
        .expect(401)
      expect(response.body.error).toBe('Invalid credentials')
    })

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL })
        .expect(400)
      expect(response.body.error).toBe('Email and password required')
    })

    it('should handle database errors gracefully with a 500', async () => {
      // Force the user lookup (db('users').where('email', ...).first()) to
      // reject so the route's catch block returns 500.
      // Prototype-chain spying is unreliable because Knex 3 defines `first` via
      // an extension mechanism (not plain prototype assignment), so walking
      // Object.getPrototypeOf() never finds it as an own property.
      // Instead, temporarily replace the module-level `db` export so the auth
      // route's compiled CJS reference (database_1.db) picks up the stub.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const dbModule = require('../src/config/database') as { db: typeof db }
      const origDb = dbModule.db
      const stubQb = {
        where: jest.fn().mockReturnThis(),
        first: jest.fn().mockRejectedValueOnce(new Error('Database connection lost')),
      }
      ;(dbModule as any).db = jest.fn(() => stubQb)

      try {
        const response = await request(app)
          .post('/api/auth/login')
          .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
          .expect(500)

        expect(response.body.error).toBe('Internal server error')
      } finally {
        ;(dbModule as any).db = origDb
      }
    })
  })

  describe('GET /api/auth/user', () => {
    let authToken: string

    beforeEach(async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      authToken = loginResponse.body.token
    })

    it('should return user info with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.user.email).toBe(ADMIN_EMAIL)
      expect(response.body.user.roles).toContain('admin')
      expect(response.body.user.id).toBeDefined()
    })

    it('should reject request without token', async () => {
      const response = await request(app).get('/api/auth/user').expect(401)
      expect(response.body.error).toBe('Access denied. No token provided.')
    })

    it('should reject invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401)
      expect(response.body.error).toBe('Invalid token.')
    })

    it('should return "User not found" for a token whose user is absent', async () => {
      const fakeToken = jwt.sign(
        { userId: '00000000-0000-0000-0000-000000000000' },
        process.env.JWT_SECRET!,
        { expiresIn: '1h' }
      )
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', `Bearer ${fakeToken}`)
        .expect(401)
      expect(response.body.error).toBe('User not found')
    })
  })

  describe('POST /api/auth/logout', () => {
    let authToken: string
    let userId: string

    beforeEach(async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      authToken = loginResponse.body.token
      userId = loginResponse.body.user.id
    })

    it('should logout successfully and remove the session', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.message).toBe('Logged out successfully')

      const remaining = await db('sessions').where('user_id', userId)
      expect(remaining).toHaveLength(0)
    })

    it('should reject logout without token', async () => {
      const response = await request(app).post('/api/auth/logout').expect(401)
      expect(response.body.error).toBe('Access denied. No token provided.')
    })
  })

  describe('CORS (mirroring src/index.ts)', () => {
    it('should include CORS headers for allowed origins', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Origin', ALLOWED_ORIGIN)
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })

      expect(response.headers['access-control-allow-origin']).toBe(
        ALLOWED_ORIGIN
      )
    })

    it('should handle preflight OPTIONS requests', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type')
        .expect(204)

      expect(response.headers['access-control-allow-origin']).toBe(
        ALLOWED_ORIGIN
      )
      expect(response.headers['access-control-allow-methods']).toContain('POST')
    })
  })

  describe('Concurrency and Performance', () => {
    it('should handle multiple concurrent login requests', async () => {
      const requests = Array(10)
        .fill(null)
        .map(() =>
          request(app)
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        )

      const responses = await Promise.all(requests)

      responses.forEach(response => {
        expect(response.status).toBe(200)
        expect(response.body).toHaveProperty('token')
      })
    }, 15000)

    it('should respond to login within an acceptable time', async () => {
      const startTime = Date.now()
      await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .expect(200)
      expect(Date.now() - startTime).toBeLessThan(5000)
    })
  })

  describe('Token Validation and Security', () => {
    let authToken: string

    beforeEach(async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      authToken = loginResponse.body.token
    })

    it('should generate valid, verifiable JWT tokens', () => {
      expect(authToken).toMatch(JWT_REGEX)
      const decoded = jwt.verify(authToken, process.env.JWT_SECRET!) as Record<
        string,
        unknown
      >
      expect(decoded).toHaveProperty('userId')
      expect(decoded).toHaveProperty('sessionId')
      expect(decoded).toHaveProperty('iat')
      expect(decoded).toHaveProperty('exp')
    })

    it('should reject expired tokens', async () => {
      const expiredToken = jwt.sign(
        { userId: '00000000-0000-0000-0000-000000000000' },
        process.env.JWT_SECRET!,
        { expiresIn: '-1h' }
      )
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401)
      expect(response.body.error).toBe('Invalid token.')
    })

    it('should reject tokens signed with the wrong secret', async () => {
      const wrongToken = jwt.sign(
        { userId: '00000000-0000-0000-0000-000000000000' },
        'wrong-secret',
        { expiresIn: '1h' }
      )
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', `Bearer ${wrongToken}`)
        .expect(401)
      expect(response.body.error).toBe('Invalid token.')
    })
  })
})
