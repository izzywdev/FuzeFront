import request from 'supertest'
import express from 'express'
import authRoutes from '../src/routes/auth'
import { initializeDatabase } from '../src/database/init'

describe('Authentication Routes', () => {
  let app: express.Application

  beforeAll(async () => {
    // Create test app
    app = express()
    app.use(express.json())
    app.use('/api/auth', authRoutes)

    // Initialize test database
    await initializeDatabase()
  })

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@frontfuse.dev',
          password: 'admin123',
        })
        .expect(200)

      expect(response.body).toHaveProperty('token')
      expect(response.body).toHaveProperty('user')
      expect(response.body.token).toBeValidJWT()
      expect(response.body.user.email).toBe('admin@frontfuse.dev')
      expect(response.body.user.roles).toContain('admin')
    })

    it('should reject invalid credentials', async () => {
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

    it('should validate email format', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'invalid-email',
          password: 'password123',
        })
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })

    it('should require password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@frontfuse.dev',
        })
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })

    it('should handle missing request body', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({})
        .expect(400)

      expect(response.body).toHaveProperty('error')
    })
  })

  describe('GET /api/auth/user', () => {
    let authToken: string

    beforeAll(async () => {
      // Get auth token for protected route tests
      const loginResponse = await request(app).post('/api/auth/login').send({
        email: 'admin@frontfuse.dev',
        password: 'admin123',
      })

      authToken = loginResponse.body.token
    })

    it('should return user info with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('user')
      expect(response.body.user.email).toBe('admin@frontfuse.dev')
      expect(response.body.user.roles).toContain('admin')
    })

    it('should reject request without token', async () => {
      const response = await request(app).get('/api/auth/user').expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Access denied. No token provided.')
    })

    it('should reject invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Invalid token.')
    })

    it('should reject malformed Authorization header', async () => {
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', 'InvalidFormat')
        .expect(401)

      expect(response.body).toHaveProperty('error')
    })
  })

  describe('POST /api/auth/logout', () => {
    let authToken: string

    beforeEach(async () => {
      // Get fresh auth token for each test
      const loginResponse = await request(app).post('/api/auth/login').send({
        email: 'admin@frontfuse.dev',
        password: 'admin123',
      })

      authToken = loginResponse.body.token
    })

    it('should logout successfully with valid token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('message')
      expect(response.body.message).toBe('Logged out successfully')
    })

    it('should reject logout without token', async () => {
      const response = await request(app).post('/api/auth/logout').expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Access denied. No token provided.')
    })

    it('should reject logout with invalid token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401)

      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Invalid token.')
    })
  })

  describe('Rate Limiting', () => {
    it('should rate limit login attempts', async () => {
      const requests = []

      // Make multiple rapid login attempts
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app).post('/api/auth/login').send({
            email: 'admin@frontfuse.dev',
            password: 'wrongpassword',
          })
        )
      }

      const responses = await Promise.all(requests)

      // At least one request should be rate limited
      const rateLimitedResponses = responses.filter(res => res.status === 429)
      expect(rateLimitedResponses.length).toBeGreaterThan(0)
    }, 15000)
  })

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      const response = await request(app).post('/api/auth/login').send({
        email: 'admin@frontfuse.dev',
        password: 'admin123',
      })

      expect(response.headers).toHaveProperty('x-content-type-options')
      expect(response.headers).toHaveProperty('x-frame-options')
    })
  })

  describe('Input Validation', () => {
    it('should sanitize input to prevent XSS', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: '<script>alert("xss")</script>@example.com',
          password: 'password123',
        })
        .expect(400)

      expect(response.body).toHaveProperty('error')
      // Ensure the script tag is not reflected in the response
      expect(JSON.stringify(response.body)).not.toContain('<script>')
    })

    it('should handle SQL injection attempts', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: "admin@frontfuse.dev'; DROP TABLE users; --",
          password: 'admin123',
        })
        .expect(401)

      // Should not crash or expose database errors
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toBe('Invalid credentials')
    })
  })

  describe('Token Validation', () => {
    let authToken: string

    beforeAll(async () => {
      const loginResponse = await request(app).post('/api/auth/login').send({
        email: 'admin@frontfuse.dev',
        password: 'admin123',
      })

      authToken = loginResponse.body.token
    })

    it('should validate token structure', () => {
      expect(authToken).toBeValidJWT()

      // JWT should have 3 parts separated by dots
      const parts = authToken.split('.')
      expect(parts).toHaveLength(3)
    })

    it('should decode token payload correctly', () => {
      const payload = JSON.parse(
        Buffer.from(authToken.split('.')[1], 'base64').toString()
      )

      expect(payload).toHaveProperty('userId')
      expect(payload).toHaveProperty('email')
      expect(payload).toHaveProperty('iat')
      expect(payload).toHaveProperty('exp')
      expect(payload.email).toBe('admin@frontfuse.dev')
    })
  })
})
