import request from 'supertest'
import express from 'express'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import authRoutes from '../src/routes/auth'
import { initializeDatabase, db } from '../src/config/database'

// JWT shape used by the runtime matcher (registered in tests/setup.ts).
const JWT_REGEX = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/

// Seeded admin (see src/seeds/001_initial_users.ts).
const ADMIN_EMAIL = 'admin@fuzefront.dev'
const ADMIN_PASSWORD = 'admin123'

/**
 * Build an app that mirrors the real src/index.ts wiring for the auth routes:
 * helmet (security headers) + json body parsing + the real auth router (which
 * itself wires the real authenticateToken middleware). We do NOT recreate
 * tables or switch to SQLite — the global tests/setup.ts has already migrated
 * and seeded the real Postgres test DB.
 */
function buildApp(): express.Application {
  const app = express()
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          frameSrc: ["'self'", '*'],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        },
      },
    })
  )
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  return app
}

describe('Authentication Routes', () => {
  let app: express.Application

  beforeAll(async () => {
    // Populate the module-level `db` instance the routes/middleware import.
    // The global setup migrated + seeded the DB but did not initialize the
    // runtime connection, so do it here.
    await initializeDatabase()
    app = buildApp()
  })

  // Note: the shared `db` connection is closed once by the global afterAll in
  // tests/setup.ts. Do NOT destroy it here or other suites lose their handle.

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials and create a session', async () => {
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
      expect(response.body.user).toHaveProperty('id')

      // Side effect: a session row must exist for the returned sessionId.
      const session = await db('sessions')
        .where('id', response.body.sessionId)
        .first()
      expect(session).toBeDefined()
      expect(session.user_id).toBe(response.body.user.id)

      // Clean up the session we created.
      await db('sessions').where('id', response.body.sessionId).del()
    })

    it('should reject invalid credentials', async () => {
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

    it('should require password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL })
        .expect(400)

      expect(response.body.error).toBe('Email and password required')
    })

    it('should require email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ password: ADMIN_PASSWORD })
        .expect(400)

      expect(response.body.error).toBe('Email and password required')
    })

    it('should reject an empty request body', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({})
        .expect(400)

      expect(response.body.error).toBe('Email and password required')
    })
  })

  describe('GET /api/auth/user', () => {
    let authToken: string
    let sessionId: string

    beforeEach(async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      authToken = loginResponse.body.token
      sessionId = loginResponse.body.sessionId
    })

    afterEach(async () => {
      if (sessionId) await db('sessions').where('id', sessionId).del()
    })

    it('should return user info with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('user')
      expect(response.body.user.email).toBe(ADMIN_EMAIL)
      expect(response.body.user.roles).toContain('admin')
      expect(response.body.user).toHaveProperty('id')
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

    it('should reject a malformed Authorization header (no Bearer token)', async () => {
      // "InvalidFormat".split(' ')[1] is undefined -> treated as no token.
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', 'InvalidFormat')
        .expect(401)
      expect(response.body.error).toBe('Access denied. No token provided.')
    })

    it('should reject a valid token for a user that no longer exists', async () => {
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

    afterEach(async () => {
      // Ensure no leftover sessions for the admin user.
      await db('sessions').where('user_id', userId).del()
    })

    it('should log out only the current session, leaving other sessions intact', async () => {
      // A second, independent login for the same user (e.g. another device).
      const second = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      const otherSessionId = second.body.sessionId
      const currentSessionId = (
        jwt.verify(authToken, process.env.JWT_SECRET!) as { sessionId: string }
      ).sessionId

      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
      expect(response.body.message).toBe('Logged out successfully')

      // Only the current session is invalidated; the other survives.
      expect(await db('sessions').where('id', currentSessionId)).toHaveLength(0)
      expect(await db('sessions').where('id', otherSessionId)).toHaveLength(1)

      await db('sessions').where('id', otherSessionId).del() // cleanup
    })

    it('should reject logout without token', async () => {
      const response = await request(app).post('/api/auth/logout').expect(401)
      expect(response.body.error).toBe('Access denied. No token provided.')
    })

    it('should reject logout with invalid token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401)
      expect(response.body.error).toBe('Invalid token.')
    })
  })

  describe('Security Headers (helmet, mirroring src/index.ts)', () => {
    it('should include security headers in responses', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })

      expect(response.headers).toHaveProperty('x-content-type-options')
      expect(response.headers).toHaveProperty('x-frame-options')

      if (response.body.sessionId) {
        await db('sessions').where('id', response.body.sessionId).del()
      }
    })
  })

  describe('Input Handling', () => {
    it('should not be vulnerable to SQL injection in the email field', async () => {
      // Knex parameterizes the query, so this is treated as a literal email
      // that does not exist -> Invalid credentials, and the users table is
      // unharmed.
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: "admin@fuzefront.dev'; DROP TABLE users; --",
          password: ADMIN_PASSWORD,
        })
        .expect(401)

      expect(response.body.error).toBe('Invalid credentials')

      // Verify the users table still exists and the admin is still present.
      const admin = await db('users').where('email', ADMIN_EMAIL).first()
      expect(admin).toBeDefined()
    })
  })

  describe('Token Validation', () => {
    let authToken: string
    let sessionId: string

    beforeAll(async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      authToken = loginResponse.body.token
      sessionId = loginResponse.body.sessionId
    })

    afterAll(async () => {
      if (sessionId) await db('sessions').where('id', sessionId).del()
    })

    it('should produce a JWT with three parts', () => {
      expect(authToken).toMatch(JWT_REGEX)
      expect(authToken.split('.')).toHaveLength(3)
    })

    it('should encode userId/iat/exp in the token payload', () => {
      // The login route signs { userId } with an expiry, so jwt adds iat/exp.
      const decoded = jwt.verify(authToken, process.env.JWT_SECRET!) as Record<
        string,
        unknown
      >
      expect(decoded).toHaveProperty('userId')
      expect(decoded).toHaveProperty('sessionId')
      expect(decoded).toHaveProperty('iat')
      expect(decoded).toHaveProperty('exp')
    })
  })
})
