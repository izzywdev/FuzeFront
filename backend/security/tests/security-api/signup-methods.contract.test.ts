/**
 * Contract tests: signup (server-brokered) + the neutral capability descriptor
 * (/methods). Asserts status codes, schemas, and vendor-neutrality of /methods.
 */
import { agent, RUNNING_AGAINST } from './harness'
import { assertSchema, FORBIDDEN_VENDOR_TOKENS } from './spec'
import { SEED } from './mockIdentityProvider'

describe(`signup + methods (against ${RUNNING_AGAINST})`, () => {
  describe('POST /signup', () => {
    it('201 → LoginResponse for a fresh account', async () => {
      const email = `new-${Date.now()}@example.com`
      const res = await agent()
        .post('/api/v1/security/signup')
        .send({ email, password: 'pw-123456', firstName: 'New', lastName: 'User' })
      expect(res.status).toBe(201)
      assertSchema('LoginResponse', res.body)
      expect(typeof res.body.token).toBe('string')
    })

    it('409 → ErrorBody when the email already exists', async () => {
      const res = await agent()
        .post('/api/v1/security/signup')
        .send({ email: SEED.email, password: 'whatever-123' })
      expect(res.status).toBe(409)
      assertSchema('ErrorBody', res.body)
    })

    it('400 → ErrorBody on a malformed body (missing password)', async () => {
      const res = await agent().post('/api/v1/security/signup').send({ email: 'x@y.com' })
      expect(res.status).toBe(400)
      assertSchema('ErrorBody', res.body)
    })
  })

  describe('GET /methods', () => {
    it('200 → AuthMethods capability descriptor', async () => {
      const res = await agent().get('/api/v1/security/methods')
      expect(res.status).toBe(200)
      assertSchema('AuthMethods', res.body)
    })

    it('names no vendor anywhere in the descriptor (neutrality)', async () => {
      const res = await agent().get('/api/v1/security/methods')
      const blob = JSON.stringify(res.body).toLowerCase()
      for (const vendor of FORBIDDEN_VENDOR_TOKENS) {
        expect(blob).not.toContain(vendor)
      }
      // Legacy vendor-specific boolean must be gone.
      expect(res.body).not.toHaveProperty('oidcConfigured')
    })
  })
})
