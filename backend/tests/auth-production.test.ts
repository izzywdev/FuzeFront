import request from 'supertest'
import express from 'express'
import cors from 'cors'
import authRoutes from '../src/routes/auth'
import { db } from '../src/config/database'

describe('Authentication - Production Database Tests', () => {
  let app: express.Application

  beforeAll(async () => {
    // Create test app with production-like setup
    app = express()
    app.use(express.json())
    app.use(
      cors({
        origin: ['http://localhost:8085', 'http://localhost:5173'],
        credentials: true,
      })
    )
    app.use('/api/auth', authRoutes)

    // Ensure database connection is established
    try {
      await db.raw('SELECT 1')
      console.log('✅ Database connection established for tests')
    } catch (error) {
      console.error('❌ Database connection failed:', error)
      throw error
    }
  })

  afterAll(async () => {
    // Clean up database connections
    await db.destroy()
  })

  describe('Database Connectivity', () => {
    it('should connect to the production database', async () => {
      const result = await db.raw('SELECT 1 as test')
      expect(result).toBeDefined()
      expect(result.rows[0].test).toBe(1)
    })

    it('should have users table with admin user', async () => {
      const adminUser = await db('users')
        .where('email', 'admin@frontfuse.dev')
        .first()

      expect(adminUser).toBeDefined()
      expect(adminUser.email).toBe('admin@frontfuse.dev')
      expect(adminUser.password_hash).toBeDefined()
    })

    it('should have sessions table', async () => {
      const tableExists = await db.schema.hasTable('sessions')
      expect(tableExists).toBe(true)
    })
  })

  describe('POST /api/auth/login - Production Tests', () => {
    it('should login with valid admin credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@frontfuse.dev',
          password: 'admin123',
        })
        .expect(200)

      expect(response.body).toHaveProperty('token')
      expect(response.body).toHaveProperty('user')
      expect(response.body).toHaveProperty('sessionId')
      expect(response.body.token).toBeValidJWT()
      expect(response.body.user.email).toBe('admin@frontfuse.dev')
      expect(response.body.user.roles).toContain('admin')

      // Verify session was created in database
      const session = await db('sessions')
        .where('id', response.body.sessionId)
        .first()
      expect(session).toBeDefined()
    })

    it('should reject invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@frontfuse.dev',
          password: 'wrongpassword',
        })
        .expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Invalid credentials')
    })

    it('should reject non-existent user', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123',
        })
        .expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Invalid credentials')
    })

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@frontfuse.dev',
        })
        .expect(400)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Email and password required')
    })

    it('should handle database errors gracefully', async () => {
      // Temporarily break database connection
      const originalDb = app.locals.db

      // Mock a database error
      jest.spyOn(db, 'where').mockImplementationOnce(() => {
        throw new Error('Database connection lost')
      })

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@frontfuse.dev',
          password: 'admin123',
        })
        .expect(500)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Internal server error')

      // Restore original implementation
      jest.restoreAllMocks()
    })
  })

  describe('GET /api/auth/user - Production Tests', () => {
    let authToken: string
    let sessionId: string

    beforeEach(async () => {
      // Get fresh auth token for each test
      const loginResponse = await request(app).post('/api/auth/login').send({
        email: 'admin@frontfuse.dev',
        password: 'admin123',
      })

      authToken = loginResponse.body.token
      sessionId = loginResponse.body.sessionId
    })

    it('should return user info with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('user')
      expect(response.body.user.email).toBe('admin@frontfuse.dev')
      expect(response.body.user.roles).toContain('admin')
      expect(response.body.user.id).toBeDefined()
    })

    it('should reject request without token', async () => {
      const response = await request(app).get('/api/auth/user').expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Access token required')
    })

    it('should reject invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', 'Bearer invalid-token')
        .expect(403)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Invalid token')
    })

    it('should handle user not found in database', async () => {
      // Create a token for a non-existent user
      const jwt = require('jsonwebtoken')
      const fakeToken = jwt.sign(
        { userId: 'non-existent-user-id' },
        process.env.JWT_SECRET!,
        { expiresIn: '1h' }
      )

      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', `Bearer ${fakeToken}`)
        .expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('User not found')
    })
  })

  describe('POST /api/auth/logout - Production Tests', () => {
    let authToken: string
    let sessionId: string

    beforeEach(async () => {
      // Get fresh auth token for each test
      const loginResponse = await request(app).post('/api/auth/login').send({
        email: 'admin@frontfuse.dev',
        password: 'admin123',
      })

      authToken = loginResponse.body.token
      sessionId = loginResponse.body.sessionId
    })

    it('should logout successfully and remove session', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('message')
      expect(response.body.message).toBe('Logged out successfully')

      // Verify session was removed from database
      const session = await db('sessions').where('id', sessionId).first()
      expect(session).toBeUndefined()
    })

    it('should reject logout without token', async () => {
      const response = await request(app).post('/api/auth/logout').expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Access token required')
    })
  })

  describe('CORS and Security Headers', () => {
    it('should include CORS headers for allowed origins', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Origin', 'http://localhost:8085')
        .send({
          email: 'admin@frontfuse.dev',
          password: 'admin123',
        })

      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:8085'
      )
    })

    it('should handle preflight OPTIONS requests', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', 'http://localhost:8085')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type')
        .expect(204)

      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:8085'
      )
      expect(response.headers['access-control-allow-methods']).toContain('POST')
    })
  })

  describe('Performance and Load Tests', () => {
    it('should handle multiple concurrent login requests', async () => {
      const requests = Array(10)
        .fill(null)
        .map(() =>
          request(app).post('/api/auth/login').send({
            email: 'admin@frontfuse.dev',
            password: 'admin123',
          })
        )

      const responses = await Promise.all(requests)

      responses.forEach(response => {
        expect(response.status).toBe(200)
        expect(response.body).toHaveProperty('token')
      })

      // Clean up sessions
      const sessionIds = responses.map(r => r.body.sessionId)
      await db('sessions').whereIn('id', sessionIds).del()
    }, 15000)

    it('should respond to login within acceptable time', async () => {
      const startTime = Date.now()

      await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@frontfuse.dev',
          password: 'admin123',
        })
        .expect(200)

      const responseTime = Date.now() - startTime
      expect(responseTime).toBeLessThan(2000) // Should respond within 2 seconds
    })
  })

  describe('Token Validation and Security', () => {
    let authToken: string

    beforeEach(async () => {
      const loginResponse = await request(app).post('/api/auth/login').send({
        email: 'admin@frontfuse.dev',
        password: 'admin123',
      })

      authToken = loginResponse.body.token
    })

    it('should generate valid JWT tokens', () => {
      expect(authToken).toBeValidJWT()

      const jwt = require('jsonwebtoken')
      const decoded = jwt.verify(authToken, process.env.JWT_SECRET!)

      expect(decoded).toHaveProperty('userId')
      expect(decoded).toHaveProperty('iat')
      expect(decoded).toHaveProperty('exp')
    })

    it('should reject expired tokens', async () => {
      const jwt = require('jsonwebtoken')
      const expiredToken = jwt.sign(
        { userId: 'test-user' },
        process.env.JWT_SECRET!,
        { expiresIn: '-1h' } // Expired 1 hour ago
      )

      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(403)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Invalid token')
    })

    it('should reject tokens with wrong secret', async () => {
      const jwt = require('jsonwebtoken')
      const wrongToken = jwt.sign({ userId: 'test-user' }, 'wrong-secret', {
        expiresIn: '1h',
      })

      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', `Bearer ${wrongToken}`)
        .expect(403)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Invalid token')
    })
  })
})
