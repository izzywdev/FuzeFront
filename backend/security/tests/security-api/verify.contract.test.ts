/**
 * Contract tests: contact-ownership verification (email + phone) + status.
 */
import { agent, RUNNING_AGAINST } from './harness'
import { assertSchema } from './spec'
import { SEED } from './mockIdentityProvider'

async function token() {
  const res = await agent()
    .post('/api/v1/security/session')
    .send({ email: SEED.email, password: SEED.password })
  return res.body.token as string
}

describe(`contact verification (against ${RUNNING_AGAINST})`, () => {
  describe('email', () => {
    it('POST /verify/email/start (signup-scoped address) → 202', async () => {
      const res = await agent()
        .post('/api/v1/security/verify/email/start')
        .send({ email: 'pending@example.com' })
      expect(res.status).toBe(202)
    })

    it('POST /verify/email/confirm with a valid OTP → 200 VerificationStatus', async () => {
      const res = await agent()
        .post('/api/v1/security/verify/email/confirm')
        .send({ code: '000000' })
      expect(res.status).toBe(200)
      assertSchema('VerificationStatus', res.body)
      expect(res.body.emailVerified).toBe(true)
    })

    it('POST /verify/email/confirm with a bad token/code → 400 (fail-closed)', async () => {
      const res = await agent()
        .post('/api/v1/security/verify/email/confirm')
        .send({ code: '999999' })
      expect(res.status).toBe(400)
      assertSchema('ErrorBody', res.body)
    })
  })

  describe('phone', () => {
    it('POST /verify/phone/start requires auth (401 without token)', async () => {
      const res = await agent()
        .post('/api/v1/security/verify/phone/start')
        .send({ phone: '+15550001111' })
      expect(res.status).toBe(401)
      assertSchema('ErrorBody', res.body)
    })

    it('POST /verify/phone/start (authed) → 202', async () => {
      const t = await token()
      const res = await agent()
        .post('/api/v1/security/verify/phone/start')
        .set('Authorization', `Bearer ${t}`)
        .send({ phone: '+15550001111' })
      expect(res.status).toBe(202)
    })

    it('POST /verify/phone/confirm valid → 200; bad code → 400', async () => {
      const ok = await agent()
        .post('/api/v1/security/verify/phone/confirm')
        .send({ phone: '+15550001111', code: '000000' })
      expect(ok.status).toBe(200)
      assertSchema('VerificationStatus', ok.body)
      expect(ok.body.phoneVerified).toBe(true)

      const bad = await agent()
        .post('/api/v1/security/verify/phone/confirm')
        .send({ phone: '+15550001111', code: '424242' })
      expect(bad.status).toBe(400)
      assertSchema('ErrorBody', bad.body)
    })
  })

  describe('status', () => {
    it('GET /verify/status (authed) → 200 VerificationStatus', async () => {
      const t = await token()
      const res = await agent()
        .get('/api/v1/security/verify/status')
        .set('Authorization', `Bearer ${t}`)
      expect(res.status).toBe(200)
      assertSchema('VerificationStatus', res.body)
    })

    it('GET /verify/status without token → 401', async () => {
      const res = await agent().get('/api/v1/security/verify/status')
      expect(res.status).toBe(401)
      assertSchema('ErrorBody', res.body)
    })
  })
})
