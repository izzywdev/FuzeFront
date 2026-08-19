/**
 * Contract tests: AuthN session lifecycle + code exchange + the SessionResult
 * MFA-step-up discriminated union. Asserts status codes and response schemas
 * against the FROZEN spec (packages/security/openapi.yaml).
 */
import { agent, RUNNING_AGAINST } from './harness'
import { assertSchema } from './spec'
import { SEED } from './mockIdentityProvider'

describe(`session (against ${RUNNING_AGAINST})`, () => {
  describe('POST /session — password login', () => {
    it('200 → SessionResult(authenticated) for valid credentials', async () => {
      const res = await agent()
        .post('/api/v1/security/session')
        .send({ email: SEED.email, password: SEED.password })
      expect(res.status).toBe(200)
      // SessionResult union — the authenticated variant.
      assertSchema('SessionResult', res.body)
      expect(res.body.status).toBe('authenticated')
      expect(typeof res.body.token).toBe('string')
      expect(res.body.user).toBeDefined()
      assertSchema('AuthenticatedSession', res.body)
    })

    it('200 → SessionResult(mfa_required) when the account has MFA enabled', async () => {
      const res = await agent()
        .post('/api/v1/security/session')
        .send({ email: SEED.mfaEmail, password: SEED.mfaPassword })
      expect(res.status).toBe(200)
      assertSchema('SessionResult', res.body)
      expect(res.body.status).toBe('mfa_required')
      assertSchema('MfaRequiredChallenge', res.body)
      expect(typeof res.body.challengeId).toBe('string')
      expect(Array.isArray(res.body.factors)).toBe(true)
      for (const f of res.body.factors) assertSchema('MfaFactorRef', f)
    })

    it('401 → ErrorBody on bad credentials (fail-closed, never a session)', async () => {
      const res = await agent()
        .post('/api/v1/security/session')
        .send({ email: SEED.email, password: 'wrong-password' })
      expect(res.status).toBe(401)
      assertSchema('ErrorBody', res.body)
      expect(res.body).not.toHaveProperty('token')
    })

    it('400 → ErrorBody on malformed request (missing password)', async () => {
      const res = await agent().post('/api/v1/security/session').send({ email: SEED.email })
      expect(res.status).toBe(400)
      assertSchema('ErrorBody', res.body)
    })
  })

  describe('GET /session — current identity ("me")', () => {
    it('200 → SessionInfo for a valid bearer token', async () => {
      const login = await agent()
        .post('/api/v1/security/session')
        .send({ email: SEED.email, password: SEED.password })
      const token = login.body.token
      const res = await agent()
        .get('/api/v1/security/session')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
      assertSchema('SessionInfo', res.body)
      assertSchema('Identity', res.body.identity)
    })

    it('401 → ErrorBody with no token (fail-closed)', async () => {
      const res = await agent().get('/api/v1/security/session')
      expect(res.status).toBe(401)
      assertSchema('ErrorBody', res.body)
    })

    it('401 → ErrorBody with an unknown/garbage token', async () => {
      const res = await agent()
        .get('/api/v1/security/session')
        .set('Authorization', 'Bearer not-a-real-token')
      expect(res.status).toBe(401)
      assertSchema('ErrorBody', res.body)
    })
  })

  describe('DELETE /session — logout', () => {
    it('204 revokes the current session and is idempotent', async () => {
      const login = await agent()
        .post('/api/v1/security/session')
        .send({ email: SEED.email, password: SEED.password })
      const token = login.body.token
      const first = await agent()
        .delete('/api/v1/security/session')
        .set('Authorization', `Bearer ${token}`)
      expect(first.status).toBe(204)
    })

    it('401 without a token', async () => {
      const res = await agent().delete('/api/v1/security/session')
      expect(res.status).toBe(401)
      assertSchema('ErrorBody', res.body)
    })
  })

  describe('POST /session/exchange — opaque broker code → session', () => {
    it('401 → ErrorBody on an unknown/expired code (fail-closed)', async () => {
      const res = await agent()
        .post('/api/v1/security/session/exchange')
        .send({ code: 'totally-unknown-code' })
      expect(res.status).toBe(401)
      assertSchema('ErrorBody', res.body)
      expect(res.body).not.toHaveProperty('token')
    })

    it('400 → ErrorBody on a malformed request (missing code)', async () => {
      const res = await agent().post('/api/v1/security/session/exchange').send({})
      expect(res.status).toBe(400)
      assertSchema('ErrorBody', res.body)
    })
  })
})
