/**
 * Unit tests for the `/api/v1/security` AuthN router.
 *
 * The router is tested against a FAKE `IdentityProvider` injected via
 * `setIdentityProvider`, so these assert the HTTP contract (status codes,
 * envelope shapes, the `SessionResult` discriminator, bearer enforcement, and
 * fail-closed error mapping) independent of the concrete provider.
 */
import express from 'express'
import request from 'supertest'
import securityRouter from '../src/routes/security'
import { setIdentityProvider } from '../src/providers/factory'
import {
  MfaRequiredError,
  ConflictError,
  UnauthorizedError,
  InvalidInputError,
  NotFoundError,
} from '../src/providers/authentik/AuthentikIdentityProvider'
import type { IdentityProvider, BrokeredSession } from '../src/providers/IdentityProvider'

const USER = { id: 'u1', email: 'u@e.com', firstName: 'U', lastName: 'E', roles: ['user'] }
const SESSION: BrokeredSession = { token: 'tok', sessionId: 'sess', user: USER }

function fakeProvider(overrides: Partial<IdentityProvider> = {}): IdentityProvider {
  const base: Partial<IdentityProvider> = {
    passwordLogin: jest.fn().mockResolvedValue(SESSION),
    startSocialLogin: jest.fn().mockResolvedValue({ redirectUrl: '/api/auth/idp/application/o/authorize/?x=1', state: 'st' }),
    brokerCallback: jest.fn().mockResolvedValue({ code: 'opaque', redirectTo: '/home' }),
    exchangeCode: jest.fn().mockResolvedValue(SESSION),
    signup: jest.fn().mockResolvedValue(SESSION),
    getUserInfo: jest.fn().mockResolvedValue({
      identity: { userId: 'u1', tenantId: null, roles: ['user'], authMode: 'legacy-hs256' },
      user: USER,
    }),
    logout: jest.fn().mockResolvedValue(undefined),
    issueM2MToken: jest.fn().mockResolvedValue({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 3600 }),
    introspectToken: jest.fn().mockResolvedValue({ active: true, subject: 'u1' }),
    listFactors: jest.fn().mockResolvedValue([{ factorId: 'f1', type: 'totp', status: 'active' }]),
    enrollFactor: jest.fn().mockResolvedValue({ factorId: 'f1', type: 'totp', status: 'pending', secret: 'S', provisioningUri: 'otpauth://x' }),
    activateFactor: jest.fn().mockResolvedValue({ factorId: 'f1', type: 'totp', status: 'active' }),
    removeFactor: jest.fn().mockResolvedValue(undefined),
    regenerateRecoveryCodes: jest.fn().mockResolvedValue(['c1', 'c2']),
    challengeMfa: jest.fn().mockResolvedValue({ challengeId: 'ch', factorId: 'f1', delivered: true }),
    verifyMfa: jest.fn().mockResolvedValue(SESSION),
    startEmailVerification: jest.fn().mockResolvedValue(undefined),
    confirmEmailVerification: jest.fn().mockResolvedValue({ emailVerified: true, phoneVerified: false }),
    startPhoneVerification: jest.fn().mockResolvedValue(undefined),
    confirmPhoneVerification: jest.fn().mockResolvedValue({ emailVerified: false, phoneVerified: true, phone: '+1555' }),
    getVerificationStatus: jest.fn().mockResolvedValue({ emailVerified: true, phoneVerified: false }),
    getIdentityConnections: jest.fn().mockResolvedValue({
      providers: [{ provider: 'google' }],
      hasPassword: true,
    }),
    setPassword: jest.fn().mockResolvedValue({
      providers: [{ provider: 'google' }],
      hasPassword: true,
    }),
    listSessions: jest.fn().mockResolvedValue([
      { id: 'sess', current: true, createdAt: '2026-07-31T00:00:00.000Z' },
    ]),
    revokeOtherSessions: jest.fn().mockResolvedValue(undefined),
    revokeSession: jest.fn().mockResolvedValue(undefined),
    provisionM2MClient: jest.fn(),
  }
  return { ...base, ...overrides } as IdentityProvider
}

function makeApp(p: IdentityProvider) {
  setIdentityProvider(p)
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', securityRouter)
  return app
}

afterEach(() => setIdentityProvider(null))

describe('GET /identity/connections', () => {
  it('returns 200 application/json connections for an authorized caller without a 403 forbidden result', async () => {
    // @fuzequality api getIdentityConnections
    const res = await request(makeApp(fakeProvider()))
      .get('/api/v1/security/identity/connections')
      .set('Authorization', 'Bearer tok')

    expect(res.status).toBe(200)
    expect(res.type).toMatch(/json/)
    expect(res.body).toEqual({
      providers: [{ provider: 'google' }],
      hasPassword: true,
    })
  })

  it('returns 401 application/json when identity connections are requested without authentication', async () => {
    // @fuzequality api getIdentityConnections
    const res = await request(makeApp(fakeProvider()))
      .get('/api/v1/security/identity/connections')

    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
})

describe('POST /password', () => {
  it('returns 200 application/json for an authorized application/json password request without a 403 forbidden result', async () => {
    // @fuzequality api setPassword
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/password')
      .set('Authorization', 'Bearer tok')
      .send({ newPassword: 'N3wPassw0rd!' })
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/json/)
    expect(res.body.hasPassword).toBe(true)
  })
  it('returns 401 application/json when setting a password without authentication', async () => {
    // @fuzequality api setPassword
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/password')
      .send({ newPassword: 'N3wPassw0rd!' })
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
  it('returns 400 application/json when newPassword is missing', async () => {
    // @fuzequality api setPassword
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/password')
      .set('Authorization', 'Bearer tok')
      .send({})
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('returns 409 application/json when a password already exists', async () => {
    // @fuzequality api setPassword
    const provider = fakeProvider({
      setPassword: jest.fn().mockRejectedValue(new ConflictError('password exists')),
    })
    const res = await request(makeApp(provider))
      .post('/api/v1/security/password')
      .set('Authorization', 'Bearer tok')
      .send({ newPassword: 'N3wPassw0rd!' })
    expect(res.status).toBe(409)
    expect(res.type).toMatch(/json/)
  })
  it('rejects an unsupported text/plain content type with 400 application/json', async () => {
    // @fuzequality api setPassword
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/password')
      .set('Authorization', 'Bearer tok')
      .set('Content-Type', 'text/plain')
      .send('newPassword=N3wPassw0rd!')
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
})

describe('POST /session (password login)', () => {
  it('returns 200 application/json for a valid application/json authenticated SessionResult', async () => {
    // @fuzequality api createSession
    const app = makeApp(fakeProvider())
    const res = await request(app).post('/api/v1/security/session').send({ email: 'u@e.com', password: 'pw' })
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/json/)
    expect(res.body.status).toBe('authenticated')
    expect(res.body.token).toBe('tok')
    expect(res.body.user.id).toBe('u1')
  })

  it('returns an mfa_required SessionResult when the provider signals step-up', async () => {
    const p = fakeProvider({
      passwordLogin: jest.fn().mockRejectedValue(new MfaRequiredError('ch1', [{ factorId: 'f1', type: 'totp' }])),
    })
    const res = await request(makeApp(p)).post('/api/v1/security/session').send({ email: 'u@e.com', password: 'pw' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('mfa_required')
    expect(res.body.challengeId).toBe('ch1')
    expect(res.body.factors).toEqual([{ factorId: 'f1', type: 'totp' }])
    expect(res.body.token).toBeUndefined()
  })

  it('returns 401 application/json for invalid credentials', async () => {
    // @fuzequality api createSession
    const err = new UnauthorizedError('bad')
    const p = fakeProvider({ passwordLogin: jest.fn().mockRejectedValue(err) })
    const res = await request(makeApp(p)).post('/api/v1/security/session').send({ email: 'x', password: 'y' })
    expect(res.status).toBe(401)
    expect(res.body.code).toBeDefined()
  })
  it('returns 400 application/json for a malformed login request', async () => {
    // @fuzequality api createSession
    const provider = fakeProvider({
      passwordLogin: jest.fn().mockRejectedValue(new InvalidInputError('email and password are required')),
    })
    const res = await request(makeApp(provider)).post('/api/v1/security/session').send({})
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('rejects an unsupported text/plain content type with 400 application/json', async () => {
    // @fuzequality api createSession
    const provider = fakeProvider({
      passwordLogin: jest.fn().mockRejectedValue(new InvalidInputError('email and password are required')),
    })
    const res = await request(makeApp(provider))
      .post('/api/v1/security/session')
      .set('Content-Type', 'text/plain')
      .send('email=u@e.com&password=pw')
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })

  // A provider outage is a SERVICE condition, not a credential verdict. These
  // used to return 401, which made an incident indistinguishable from a typo:
  // the login UI could only hedge ("wrong password, OR the service is down"),
  // and the outage hid inside auth-failure metrics.
  for (const name of ['AuthentikUnavailableError', 'UnsupportedFlowStageError']) {
    it(`maps ${name} to 503 PROVIDER_UNAVAILABLE, not 401`, async () => {
      // @fuzequality api createSession
      const err = new Error('provider is having a bad day')
      err.name = name
      const p = fakeProvider({ passwordLogin: jest.fn().mockRejectedValue(err) })
      const res = await request(makeApp(p))
        .post('/api/v1/security/session')
        .send({ email: 'x', password: 'y' })

      expect(res.status).toBe(503)
      expect(res.body.code).toBe('PROVIDER_UNAVAILABLE')
      // Marked retryable so clients (and probes) treat it as transient.
      expect(res.headers['retry-after']).toBeDefined()
      // The provider's raw message can name internal hosts/flow slugs — it
      // must not be echoed to an unauthenticated caller.
      expect(JSON.stringify(res.body)).not.toContain('bad day')
    })
  }
})

describe('GET /session (me) — bearer enforcement', () => {
  it('returns 401 application/json without authentication', async () => {
    // @fuzequality api getSession
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/session')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
    expect(res.body.code).toBe('NO_TOKEN')
  })
  it('returns 200 application/json identity and user for an authorized caller without a 403 forbidden result', async () => {
    // @fuzequality api getSession
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/session').set('Authorization', 'Bearer tok')
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/json/)
    expect(res.body.identity.userId).toBe('u1')
    expect(res.body.user.email).toBe('u@e.com')
  })
})

describe('DELETE /session (logout)', () => {
  it('returns 204 for an authorized idempotent logout without a 403 forbidden result', async () => {
    // @fuzequality api deleteSession
    const p = fakeProvider()
    const res = await request(makeApp(p)).delete('/api/v1/security/session').set('Authorization', 'Bearer tok')
    expect(res.status).toBe(204)
    expect(p.logout).toHaveBeenCalledWith('tok')
  })
  it('returns 401 application/json when logout is requested without authentication', async () => {
    // @fuzequality api deleteSession
    const res = await request(makeApp(fakeProvider())).delete('/api/v1/security/session')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
})

describe('DELETE /sessions', () => {
  it('returns 204 for an authorized idempotent bulk revoke without a 403 forbidden result', async () => {
    // @fuzequality api revokeOtherSessions
    const provider = fakeProvider()
    const res = await request(makeApp(provider))
      .delete('/api/v1/security/sessions')
      .set('Authorization', 'Bearer tok')
    expect(res.status).toBe(204)
    expect(provider.revokeOtherSessions).toHaveBeenCalledWith('tok')
  })
  it('returns 401 application/json when bulk revoke is requested without authentication', async () => {
    // @fuzequality api revokeOtherSessions
    const res = await request(makeApp(fakeProvider())).delete('/api/v1/security/sessions')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
})

describe('GET /sessions', () => {
  it('returns 200 application/json sessions for an authorized caller without a 403 forbidden result', async () => {
    // @fuzequality api listSessions
    const provider = fakeProvider()
    const res = await request(makeApp(provider))
      .get('/api/v1/security/sessions')
      .set('Authorization', 'Bearer tok')
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/json/)
    expect(res.body.items).toHaveLength(1)
    expect(provider.listSessions).toHaveBeenCalledWith('tok')
  })
  it('returns 401 application/json when sessions are listed without authentication', async () => {
    // @fuzequality api listSessions
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/sessions')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
})

describe('DELETE /sessions/:id', () => {
  it('returns 204 for an authorized idempotent session lifecycle revoke without a 403 forbidden result', async () => {
    // @fuzequality api revokeSession
    const provider = fakeProvider()
    const res = await request(makeApp(provider))
      .delete('/api/v1/security/sessions/session-2')
      .set('Authorization', 'Bearer tok')
    expect(res.status).toBe(204)
    expect(provider.revokeSession).toHaveBeenCalledWith('tok', 'session-2')
  })
  it('returns 401 application/json when a session is revoked without authentication', async () => {
    // @fuzequality api revokeSession
    const res = await request(makeApp(fakeProvider())).delete('/api/v1/security/sessions/session-2')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
  it('returns 404 application/json for an unknown session resource', async () => {
    // @fuzequality api revokeSession
    const provider = fakeProvider({
      revokeSession: jest.fn().mockRejectedValue(new NotFoundError('session not found')),
    })
    const res = await request(makeApp(provider))
      .delete('/api/v1/security/sessions/unknown-session')
      .set('Authorization', 'Bearer tok')
    expect(res.status).toBe(404)
    expect(res.type).toMatch(/json/)
  })
  it('routes to bulk revoke when the required id path parameter is missing', async () => {
    // @fuzequality api revokeSession
    const provider = fakeProvider()
    const res = await request(makeApp(provider))
      .delete('/api/v1/security/sessions/')
      .set('Authorization', 'Bearer tok')
    expect(res.status).toBe(204)
    expect(provider.revokeOtherSessions).toHaveBeenCalledWith('tok')
    expect(provider.revokeSession).not.toHaveBeenCalled()
  })
})

describe('POST /session/exchange', () => {
  it('returns 400 application/json when the exchange code is missing', async () => {
    // @fuzequality api exchangeSessionCode
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/session/exchange').send({})
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('returns 200 application/json for a valid application/json opaque exchange code', async () => {
    // @fuzequality api exchangeSessionCode
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/session/exchange').send({ code: 'opaque' })
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/json/)
    expect(res.body.status).toBe('authenticated')
  })
  it('rejects an unsupported text/plain content type with 400 application/json', async () => {
    // @fuzequality api exchangeSessionCode
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/session/exchange')
      .set('Content-Type', 'text/plain')
      .send('code=opaque')
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('returns 401 application/json for an unauthorized or expired exchange code', async () => {
    // @fuzequality api exchangeSessionCode
    const provider = fakeProvider({
      exchangeCode: jest.fn().mockRejectedValue(new UnauthorizedError('expired code')),
    })
    const res = await request(makeApp(provider))
      .post('/api/v1/security/session/exchange')
      .send({ code: 'expired' })
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
})

describe('social login boundary', () => {
  it('302s to a SAME-HOST idp path — never an internal identity host', async () => {
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/social/google/start')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/api/auth/idp/application/o/authorize/?x=1')
    expect(res.headers.location).not.toMatch(/auth\.fuzefront\.com/)
    // `set-cookie` is typed `string | string[]` (supertest gives an array when
    // several are set, a bare string for one). Normalise rather than assuming
    // the array shape — the unguarded `.join` failed to COMPILE, which took the
    // whole suite down with it, so nothing in this file has been running.
    expect([res.headers['set-cookie']].flat().join(';')).toMatch(
      /sec_social_state=/
    )
  })
  it('callback returns 302 with required code and state to a FuzeFront opaque code', async () => {
    // @fuzequality api socialCallback
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/social/callback?code=prov&state=st')
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/[?&]code=opaque/)
    expect(res.headers.location).not.toMatch(/token=/)
  })
  it('callback returns a controlled 302 when the required code query parameter is missing', async () => {
    // @fuzequality api socialCallback
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/social/callback?state=st')
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('error=authentication_failed')
  })
  it('callback returns a controlled 302 when the required state query parameter is missing', async () => {
    // @fuzequality api socialCallback
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/social/callback?code=prov')
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('error=authentication_failed')
  })
})

describe('POST /signup', () => {
  it('returns 201 application/json for a valid application/json signup', async () => {
    // @fuzequality api signup
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/signup').send({ email: 'n@e.com', password: 'pw' })
    expect(res.status).toBe(201)
    expect(res.type).toMatch(/json/)
    expect(res.body.token).toBe('tok')
  })
  it('returns 409 application/json when signup conflicts with an existing account', async () => {
    // @fuzequality api signup
    const p = fakeProvider({ signup: jest.fn().mockRejectedValue(new ConflictError()) })
    const res = await request(makeApp(p)).post('/api/v1/security/signup').send({ email: 'dup@e.com', password: 'pw' })
    expect(res.status).toBe(409)
    expect(res.type).toMatch(/json/)
    expect(res.body.code).toBe('CONFLICT')
  })
  it('returns 400 application/json for a malformed signup request', async () => {
    // @fuzequality api signup
    const provider = fakeProvider({
      signup: jest.fn().mockRejectedValue(new InvalidInputError('email and password are required')),
    })
    const res = await request(makeApp(provider)).post('/api/v1/security/signup').send({})
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('rejects an unsupported text/plain content type with 400 application/json', async () => {
    // @fuzequality api signup
    const provider = fakeProvider({
      signup: jest.fn().mockRejectedValue(new InvalidInputError('email and password are required')),
    })
    const res = await request(makeApp(provider))
      .post('/api/v1/security/signup')
      .set('Content-Type', 'text/plain')
      .send('email=n@e.com&password=pw')
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('returns 503 application/json when the identity provider is unavailable', async () => {
    // @fuzequality api signup
    const unavailable = new Error('provider unavailable')
    unavailable.name = 'AuthentikUnavailableError'
    const provider = fakeProvider({ signup: jest.fn().mockRejectedValue(unavailable) })
    const res = await request(makeApp(provider))
      .post('/api/v1/security/signup')
      .send({ email: 'n@e.com', password: 'pw' })
    expect(res.status).toBe(503)
    expect(res.type).toMatch(/json/)
  })
})

describe('GET /methods', () => {
  // The descriptor is derived from process.env, so each case owns a clean slate.
  const CAP_VARS = ['SMS_SERVICE_URL', 'EMAIL_SERVICE_URL', 'REQUIRE_EMAIL_VERIFICATION', 'SECURITY_SOCIAL_GOOGLE']
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(CAP_VARS.map(k => [k, process.env[k]]))
    for (const k of CAP_VARS) delete process.env[k]
  })
  afterEach(() => {
    for (const k of CAP_VARS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k] as string
    }
  })

  const methods = () => request(makeApp(fakeProvider())).get('/api/v1/security/methods')

  it('returns 200 application/json methods when only totp is configured', async () => {
    // @fuzequality api getAuthMethods
    const res = await methods()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      password: true,
      mfa: { enabled: true, types: ['totp'] },
      verification: { email: false, sms: false },
    })
  })

  it('SMS_SERVICE_URL configured: sms factor + sms verification appear', async () => {
    process.env.SMS_SERVICE_URL = 'http://sms-service:3000'
    const res = await methods()
    expect(res.body.mfa.types).toEqual(['totp', 'sms'])
    expect(res.body.verification.sms).toBe(true)
    expect(res.body.verification.email).toBe(false)
  })

  it('blank SMS_SERVICE_URL is not "configured"', async () => {
    process.env.SMS_SERVICE_URL = '   '
    const res = await methods()
    expect(res.body.mfa.types).toEqual(['totp'])
    expect(res.body.verification.sms).toBe(false)
  })

  it('email verification enabled (both conditions): email factor + email verification appear', async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true'
    process.env.EMAIL_SERVICE_URL = 'http://email-service:3000'
    const res = await methods()
    expect(res.body.mfa.types).toEqual(['totp', 'email'])
    expect(res.body.verification.email).toBe(true)
  })

  it('email transport without the switch stays OFF (degrade mode is not a capability)', async () => {
    process.env.EMAIL_SERVICE_URL = 'http://email-service:3000'
    const res = await methods()
    expect(res.body.mfa.types).toEqual(['totp'])
    expect(res.body.verification.email).toBe(false)
  })

  it('the switch without a transport stays OFF', async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true'
    const res = await methods()
    expect(res.body.verification.email).toBe(false)
  })

  it('everything configured: all three factors', async () => {
    process.env.SMS_SERVICE_URL = 'http://sms-service:3000'
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true'
    process.env.EMAIL_SERVICE_URL = 'http://email-service:3000'
    const res = await methods()
    expect(res.body.mfa).toEqual({ enabled: true, types: ['totp', 'sms', 'email'] })
    expect(res.body.verification).toEqual({ email: true, sms: true })
  })

  it('stays neutral (no vendor names) and honours the social switch', async () => {
    const res = await methods()
    expect(res.body.social).toEqual(['google'])
    expect(JSON.stringify(res.body).toLowerCase()).not.toMatch(/authentik/)

    process.env.SECURITY_SOCIAL_GOOGLE = 'false'
    expect((await methods()).body.social).toEqual([])
  })
})

describe('MFA factor management', () => {
  it('GET /mfa/factors returns 200 application/json for an authorized caller without a 403 forbidden result', async () => {
    // @fuzequality api listMfaFactors
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/mfa/factors').set('Authorization', 'Bearer tok')
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/json/)
    expect(Array.isArray(res.body.items)).toBe(true)
  })
  it('GET /mfa/factors returns 401 application/json without authentication', async () => {
    // @fuzequality api listMfaFactors
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/mfa/factors')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
  it('POST /mfa/factors returns 201 application/json for an authorized application/json enrollment without a 403 forbidden result', async () => {
    // @fuzequality api enrollMfaFactor
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/factors').set('Authorization', 'Bearer tok').send({ type: 'totp' })
    expect(res.status).toBe(201)
    expect(res.type).toMatch(/json/)
    expect(res.body.provisioningUri).toBeDefined()
  })
  it('POST /mfa/factors returns 401 application/json without authentication', async () => {
    // @fuzequality api enrollMfaFactor
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/factors').send({ type: 'totp' })
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
  it('POST /mfa/factors returns 400 application/json for a malformed enrollment request', async () => {
    // @fuzequality api enrollMfaFactor
    const provider = fakeProvider({
      enrollFactor: jest.fn().mockRejectedValue(new InvalidInputError('type is required')),
    })
    const res = await request(makeApp(provider))
      .post('/api/v1/security/mfa/factors')
      .set('Authorization', 'Bearer tok')
      .send({})
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('POST /mfa/factors rejects an unsupported text/plain content type with 400 application/json', async () => {
    // @fuzequality api enrollMfaFactor
    const provider = fakeProvider({
      enrollFactor: jest.fn().mockRejectedValue(new InvalidInputError('type is required')),
    })
    const res = await request(makeApp(provider))
      .post('/api/v1/security/mfa/factors')
      .set('Authorization', 'Bearer tok')
      .set('Content-Type', 'text/plain')
      .send('type=totp')
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('activate returns 200 application/json for an authorized application/json factor without a 403 forbidden result', async () => {
    // @fuzequality api activateMfaFactor
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/mfa/factors/f1/activate')
      .set('Authorization', 'Bearer tok')
      .send({ code: '123456' })
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/json/)
    expect(res.body.status).toBe('active')
  })
  it('activate returns 400 application/json when the code is missing', async () => {
    // @fuzequality api activateMfaFactor
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/mfa/factors/f1/activate')
      .set('Authorization', 'Bearer tok')
      .send({})
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('activate returns 401 application/json without authentication', async () => {
    // @fuzequality api activateMfaFactor
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/mfa/factors/f1/activate')
      .send({ code: '123456' })
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
  it('activate returns 404 application/json for an unknown factor resource', async () => {
    // @fuzequality api activateMfaFactor
    const provider = fakeProvider({
      activateFactor: jest.fn().mockRejectedValue(new NotFoundError('factor not found')),
    })
    const res = await request(makeApp(provider))
      .post('/api/v1/security/mfa/factors/unknown-factor/activate')
      .set('Authorization', 'Bearer tok')
      .send({ code: '123456' })
    expect(res.status).toBe(404)
    expect(res.type).toMatch(/json/)
  })
  it('activate returns 404 when the required factorId path parameter is missing', async () => {
    // @fuzequality api activateMfaFactor
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/mfa/factors//activate')
      .set('Authorization', 'Bearer tok')
      .send({ code: '123456' })
    expect(res.status).toBe(404)
  })
  it('activate rejects an unsupported text/plain content type with 400 application/json', async () => {
    // @fuzequality api activateMfaFactor
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/mfa/factors/f1/activate')
      .set('Authorization', 'Bearer tok')
      .set('Content-Type', 'text/plain')
      .send('code=123456')
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('DELETE factor returns 204 for an authorized factor lifecycle without a 403 forbidden result', async () => {
    // @fuzequality api removeMfaFactor
    const res = await request(makeApp(fakeProvider())).delete('/api/v1/security/mfa/factors/f1').set('Authorization', 'Bearer tok')
    expect(res.status).toBe(204)
  })
  it('DELETE factor returns 401 application/json without authentication', async () => {
    // @fuzequality api removeMfaFactor
    const res = await request(makeApp(fakeProvider())).delete('/api/v1/security/mfa/factors/f1')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
  it('DELETE factor returns 404 application/json for an unknown factor resource', async () => {
    // @fuzequality api removeMfaFactor
    const provider = fakeProvider({
      removeFactor: jest.fn().mockRejectedValue(new NotFoundError('factor not found')),
    })
    const res = await request(makeApp(provider))
      .delete('/api/v1/security/mfa/factors/unknown-factor')
      .set('Authorization', 'Bearer tok')
    expect(res.status).toBe(404)
    expect(res.type).toMatch(/json/)
  })
  it('DELETE factor returns 404 when the required factorId path parameter is missing', async () => {
    // @fuzequality api removeMfaFactor
    const res = await request(makeApp(fakeProvider()))
      .delete('/api/v1/security/mfa/factors/')
      .set('Authorization', 'Bearer tok')
    expect(res.status).toBe(404)
  })
  it('recovery-codes returns 200 application/json once for an authorized caller without a 403 forbidden result', async () => {
    // @fuzequality api regenerateRecoveryCodes
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/recovery-codes').set('Authorization', 'Bearer tok')
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/json/)
    expect(res.body.codes).toEqual(['c1', 'c2'])
  })
  it('recovery-codes returns 401 application/json without authentication', async () => {
    // @fuzequality api regenerateRecoveryCodes
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/recovery-codes')
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
})

describe('MFA step-up', () => {
  it('returns 202 application/json for an application/json MFA challenge', async () => {
    // @fuzequality api challengeMfa
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/challenge').send({ challengeId: 'ch', factorId: 'f1' })
    expect(res.status).toBe(202)
    expect(res.type).toMatch(/json/)
    expect(res.body.delivered).toBe(true)
  })
  it('returns 400 application/json when the MFA challenge request is malformed', async () => {
    // @fuzequality api challengeMfa
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/challenge').send({ challengeId: 'ch' })
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('rejects an unsupported text/plain MFA challenge content type with 400 application/json', async () => {
    // @fuzequality api challengeMfa
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/mfa/challenge')
      .set('Content-Type', 'text/plain')
      .send('challengeId=ch&factorId=f1')
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('returns 401 application/json when the MFA challenge is unauthorized', async () => {
    // @fuzequality api challengeMfa
    const provider = fakeProvider({
      challengeMfa: jest.fn().mockRejectedValue(new UnauthorizedError('expired challenge')),
    })
    const res = await request(makeApp(provider))
      .post('/api/v1/security/mfa/challenge')
      .send({ challengeId: 'expired', factorId: 'f1' })
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
  it('verify returns 200 application/json for an application/json LoginResponse', async () => {
    // @fuzequality api verifyMfa
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/verify').send({ challengeId: 'ch', factorId: 'f1', code: '123456' })
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/json/)
    expect(res.body.token).toBe('tok')
  })
  it('verify returns 400 application/json when the code is missing', async () => {
    // @fuzequality api verifyMfa
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/verify').send({ challengeId: 'ch', factorId: 'f1' })
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('verify rejects an unsupported text/plain content type with 400 application/json', async () => {
    // @fuzequality api verifyMfa
    const res = await request(makeApp(fakeProvider()))
      .post('/api/v1/security/mfa/verify')
      .set('Content-Type', 'text/plain')
      .send('challengeId=ch&factorId=f1&code=123456')
    expect(res.status).toBe(400)
    expect(res.type).toMatch(/json/)
  })
  it('verify returns 401 application/json for an unauthorized or expired challenge', async () => {
    // @fuzequality api verifyMfa
    const provider = fakeProvider({
      verifyMfa: jest.fn().mockRejectedValue(new UnauthorizedError('expired challenge')),
    })
    const res = await request(makeApp(provider))
      .post('/api/v1/security/mfa/verify')
      .send({ challengeId: 'expired', factorId: 'f1', code: '123456' })
    expect(res.status).toBe(401)
    expect(res.type).toMatch(/json/)
  })
})

describe('contact verification', () => {
  it('email start 202', async () => {
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/verify/email/start').send({ email: 'e@e.com' })
    expect(res.status).toBe(202)
  })
  it('email confirm returns VerificationStatus', async () => {
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/verify/email/confirm').send({ token: 't' })
    expect(res.status).toBe(200)
    expect(res.body.emailVerified).toBe(true)
  })
  it('phone start requires bearer + phone', async () => {
    const noAuth = await request(makeApp(fakeProvider())).post('/api/v1/security/verify/phone/start').send({ phone: '+1555' })
    expect(noAuth.status).toBe(401)
    const noPhone = await request(makeApp(fakeProvider())).post('/api/v1/security/verify/phone/start').set('Authorization', 'Bearer tok').send({})
    expect(noPhone.status).toBe(400)
    const ok = await request(makeApp(fakeProvider())).post('/api/v1/security/verify/phone/start').set('Authorization', 'Bearer tok').send({ phone: '+1555' })
    expect(ok.status).toBe(202)
  })
  it('status requires bearer', async () => {
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/verify/status')
    expect(res.status).toBe(401)
  })
})

describe('M2M tokens', () => {
  it('issue requires clientId/clientSecret', async () => {
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/tokens').send({ clientId: 'c' })
    expect(res.status).toBe(400)
  })
  it('introspect is fail-closed (never throws)', async () => {
    const p = fakeProvider({ introspectToken: jest.fn().mockRejectedValue(new Error('boom')) })
    const res = await request(makeApp(p)).post('/api/v1/security/tokens/introspect').send({ token: 'x' })
    expect(res.status).toBe(200)
    expect(res.body.active).toBe(false)
  })
})
