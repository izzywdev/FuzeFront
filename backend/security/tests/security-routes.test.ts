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

describe('POST /session (password login)', () => {
  it('returns an authenticated SessionResult on success', async () => {
    const app = makeApp(fakeProvider())
    const res = await request(app).post('/api/v1/security/session').send({ email: 'u@e.com', password: 'pw' })
    expect(res.status).toBe(200)
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

  it('maps invalid credentials to 401 fail-closed', async () => {
    const err = new UnauthorizedError('bad')
    const p = fakeProvider({ passwordLogin: jest.fn().mockRejectedValue(err) })
    const res = await request(makeApp(p)).post('/api/v1/security/session').send({ email: 'x', password: 'y' })
    expect(res.status).toBe(401)
    expect(res.body.code).toBeDefined()
  })
})

describe('GET /session (me) — bearer enforcement', () => {
  it('401 without a bearer token', async () => {
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/session')
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('NO_TOKEN')
  })
  it('returns identity + user with a bearer token', async () => {
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/session').set('Authorization', 'Bearer tok')
    expect(res.status).toBe(200)
    expect(res.body.identity.userId).toBe('u1')
    expect(res.body.user.email).toBe('u@e.com')
  })
})

describe('DELETE /session (logout)', () => {
  it('returns 204 and is idempotent', async () => {
    const p = fakeProvider()
    const res = await request(makeApp(p)).delete('/api/v1/security/session').set('Authorization', 'Bearer tok')
    expect(res.status).toBe(204)
    expect(p.logout).toHaveBeenCalledWith('tok')
  })
})

describe('POST /session/exchange', () => {
  it('400 when code missing', async () => {
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/session/exchange').send({})
    expect(res.status).toBe(400)
  })
  it('exchanges an opaque code for an authenticated session', async () => {
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/session/exchange').send({ code: 'opaque' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('authenticated')
  })
})

describe('social login boundary', () => {
  it('302s to a SAME-HOST idp path — never an internal identity host', async () => {
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/social/google/start')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/api/auth/idp/application/o/authorize/?x=1')
    expect(res.headers.location).not.toMatch(/auth\.fuzefront\.com/)
    expect(res.headers['set-cookie'].join(';')).toMatch(/sec_social_state=/)
  })
  it('callback 302s back to the app with a FuzeFront opaque ?code= (no token in URL)', async () => {
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/social/callback?code=prov&state=st')
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/[?&]code=opaque/)
    expect(res.headers.location).not.toMatch(/token=/)
  })
})

describe('POST /signup', () => {
  it('201 with session on success', async () => {
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/signup').send({ email: 'n@e.com', password: 'pw' })
    expect(res.status).toBe(201)
    expect(res.body.token).toBe('tok')
  })
  it('409 on conflict', async () => {
    const p = fakeProvider({ signup: jest.fn().mockRejectedValue(new ConflictError()) })
    const res = await request(makeApp(p)).post('/api/v1/security/signup').send({ email: 'dup@e.com', password: 'pw' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('CONFLICT')
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

  it('nothing configured: only totp; email/sms verification reported OFF', async () => {
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
  it('GET /mfa/factors returns an { items } envelope', async () => {
    const res = await request(makeApp(fakeProvider())).get('/api/v1/security/mfa/factors').set('Authorization', 'Bearer tok')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
  })
  it('POST /mfa/factors enrolls (201 with material)', async () => {
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/factors').set('Authorization', 'Bearer tok').send({ type: 'totp' })
    expect(res.status).toBe(201)
    expect(res.body.provisioningUri).toBeDefined()
  })
  it('activate requires a code (400) and returns the factor (200)', async () => {
    const app = makeApp(fakeProvider())
    const bad = await request(app).post('/api/v1/security/mfa/factors/f1/activate').set('Authorization', 'Bearer tok').send({})
    expect(bad.status).toBe(400)
    const ok = await request(app).post('/api/v1/security/mfa/factors/f1/activate').set('Authorization', 'Bearer tok').send({ code: '123456' })
    expect(ok.status).toBe(200)
    expect(ok.body.status).toBe('active')
  })
  it('DELETE factor returns 204', async () => {
    const res = await request(makeApp(fakeProvider())).delete('/api/v1/security/mfa/factors/f1').set('Authorization', 'Bearer tok')
    expect(res.status).toBe(204)
  })
  it('recovery-codes returns codes once', async () => {
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/recovery-codes').set('Authorization', 'Bearer tok')
    expect(res.status).toBe(200)
    expect(res.body.codes).toEqual(['c1', 'c2'])
  })
})

describe('MFA step-up', () => {
  it('challenge returns 202 ack', async () => {
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/challenge').send({ challengeId: 'ch', factorId: 'f1' })
    expect(res.status).toBe(202)
    expect(res.body.delivered).toBe(true)
  })
  it('verify returns a LoginResponse on success', async () => {
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/verify').send({ challengeId: 'ch', factorId: 'f1', code: '123456' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBe('tok')
  })
  it('verify 400 when code missing', async () => {
    const res = await request(makeApp(fakeProvider())).post('/api/v1/security/mfa/verify').send({ challengeId: 'ch', factorId: 'f1' })
    expect(res.status).toBe(400)
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
