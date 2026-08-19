/**
 * Contract tests: full MFA lifecycle — factor enrollment/activation/removal,
 * recovery codes, and the login step-up (challenge → verify) path. Schemas +
 * status codes + fail-closed on bad codes, all against the frozen spec.
 */
import { agent, RUNNING_AGAINST } from './harness'
import { assertSchema } from './spec'
import { MockIdentityProvider, SEED } from './mockIdentityProvider'

// The MFA lifecycle needs a stable provider instance across requests so an
// enrolled factor persists. Against a live impl (SECURITY_BASE_URL) state is
// held server-side, so a shared provider is only wired for the contract-mock.
function ctx() {
  const provider = new MockIdentityProvider()
  return { provider, api: () => agent(provider) }
}

async function loggedInToken(api: () => ReturnType<typeof agent>) {
  const res = await api()
    .post('/api/v1/security/session')
    .send({ email: SEED.email, password: SEED.password })
  return res.body.token as string
}

describe(`mfa lifecycle + step-up (against ${RUNNING_AGAINST})`, () => {
  describe('factor management', () => {
    it('GET /mfa/factors → { items: MfaFactor[] } (401 without token)', async () => {
      const { api } = ctx()
      const unauth = await api().get('/api/v1/security/mfa/factors')
      expect(unauth.status).toBe(401)
      assertSchema('ErrorBody', unauth.body)

      const token = await loggedInToken(api)
      const res = await api()
        .get('/api/v1/security/mfa/factors')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.items)).toBe(true)
      for (const f of res.body.items) assertSchema('MfaFactor', f)
    })

    it('enroll TOTP → 201 MfaEnrollResult with secret + provisioningUri', async () => {
      const { api } = ctx()
      const token = await loggedInToken(api)
      const res = await api()
        .post('/api/v1/security/mfa/factors')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'totp' })
      expect(res.status).toBe(201)
      assertSchema('MfaEnrollResult', res.body)
      expect(res.body.type).toBe('totp')
      expect(typeof res.body.secret).toBe('string')
      expect(res.body.provisioningUri).toMatch(/^otpauth:\/\//)
    })

    it('enroll SMS without phone → 400 (fail-closed validation)', async () => {
      const { api } = ctx()
      const token = await loggedInToken(api)
      const res = await api()
        .post('/api/v1/security/mfa/factors')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'sms' })
      expect(res.status).toBe(400)
      assertSchema('ErrorBody', res.body)
    })

    it('enroll → activate happy path (200 active) and bad code → 400', async () => {
      const { api } = ctx()
      const token = await loggedInToken(api)
      const enroll = await api()
        .post('/api/v1/security/mfa/factors')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'totp' })
      const factorId = enroll.body.factorId

      const bad = await api()
        .post(`/api/v1/security/mfa/factors/${factorId}/activate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '999999' })
      expect(bad.status).toBe(400)
      assertSchema('ErrorBody', bad.body)

      const ok = await api()
        .post(`/api/v1/security/mfa/factors/${factorId}/activate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '000000' })
      expect(ok.status).toBe(200)
      assertSchema('MfaFactor', ok.body)
      expect(ok.body.status).toBe('active')
    })

    it('DELETE /mfa/factors/{id} → 204 (idempotent)', async () => {
      const { api } = ctx()
      const token = await loggedInToken(api)
      const enroll = await api()
        .post('/api/v1/security/mfa/factors')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'totp' })
      const factorId = enroll.body.factorId
      const del = await api()
        .delete(`/api/v1/security/mfa/factors/${factorId}`)
        .set('Authorization', `Bearer ${token}`)
      expect(del.status).toBe(204)
    })

    it('POST /mfa/recovery-codes → 200 RecoveryCodes', async () => {
      const { api } = ctx()
      const token = await loggedInToken(api)
      const res = await api()
        .post('/api/v1/security/mfa/recovery-codes')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
      assertSchema('RecoveryCodes', res.body)
      expect(res.body.codes.length).toBeGreaterThan(0)
    })
  })

  describe('login step-up (challenge → verify)', () => {
    it('completes MFA and returns a LoginResponse', async () => {
      const { api } = ctx()
      // Trigger the mfa_required challenge.
      const login = await api()
        .post('/api/v1/security/session')
        .send({ email: SEED.mfaEmail, password: SEED.mfaPassword })
      expect(login.body.status).toBe('mfa_required')
      const { challengeId, factors } = login.body
      const factorId = factors[0].factorId

      const challenge = await api()
        .post('/api/v1/security/mfa/challenge')
        .send({ challengeId, factorId })
      expect(challenge.status).toBe(202)
      assertSchema('MfaChallengeAck', challenge.body)

      const verify = await api()
        .post('/api/v1/security/mfa/verify')
        .send({ challengeId, factorId, code: '000000' })
      expect(verify.status).toBe(200)
      assertSchema('LoginResponse', verify.body)
      expect(typeof verify.body.token).toBe('string')
    })

    it('bad OTP on verify → 401 (fail-closed, no session)', async () => {
      const { api } = ctx()
      const login = await api()
        .post('/api/v1/security/session')
        .send({ email: SEED.mfaEmail, password: SEED.mfaPassword })
      const { challengeId, factors } = login.body
      const verify = await api()
        .post('/api/v1/security/mfa/verify')
        .send({ challengeId, factorId: factors[0].factorId, code: '111111' })
      expect(verify.status).toBe(401)
      assertSchema('ErrorBody', verify.body)
      expect(verify.body).not.toHaveProperty('token')
    })

    it('unknown challengeId on verify → 401 (fail-closed)', async () => {
      const { api } = ctx()
      const verify = await api()
        .post('/api/v1/security/mfa/verify')
        .send({ challengeId: 'nope', factorId: 'factor-totp-1', code: '000000' })
      expect(verify.status).toBe(401)
      assertSchema('ErrorBody', verify.body)
    })
  })
})
