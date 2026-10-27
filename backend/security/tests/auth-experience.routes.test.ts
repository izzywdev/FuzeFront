/**
 * Route-level tests for the auth-experience signup contract (1.0.0), gated by
 * the `fuzefront.auth.experience` release flag (default OFF).
 *
 * Both flag states are exercised for every behaviour that the flag changes:
 *   - POST /signup            single `name`, password policy, Turnstile
 *   - GET  /methods           passwordPolicy + captcha advertising
 *   - GET  /signup/email-available   the contract alias
 *
 * The router runs against a FAKE IdentityProvider (no Authentik) and a stubbed
 * global.fetch standing in for Cloudflare `siteverify` (no network; Cloudflare's
 * published dummy keys). The flag client is pinned in-memory via
 * setIdentityFlagClient, per the feature-flags skill's test-both-states rule.
 */
import express from 'express'
import request from 'supertest'
import securityRouter from '../src/routes/security'
import { setIdentityProvider } from '../src/providers/factory'
import { ConflictError } from '../src/providers/authentik/AuthentikIdentityProvider'
import type { IdentityProvider, BrokeredSession } from '../src/providers/IdentityProvider'
import { FLAGS, setIdentityFlagClient } from '../src/identity/flags'

const USER = { id: 'u1', email: 'u@e.com', roles: ['user'] }
const SESSION: BrokeredSession = { token: 'tok', sessionId: 'sess', user: USER }

const STRONG = 'Correct-Horse-9'
const SITE_KEY = '1x00000000000000000000AA'
const SECRET_PASS = '1x0000000000000000000000000000000AA'
const SECRET_FAIL = '2x0000000000000000000000000000000AA'
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

function provider(overrides: Partial<IdentityProvider> = {}): IdentityProvider {
  return {
    signup: jest.fn().mockResolvedValue(SESSION),
    emailExists: jest.fn().mockResolvedValue(false),
    ...overrides,
  } as unknown as IdentityProvider
}

function makeApp(p: IdentityProvider) {
  setIdentityProvider(p)
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', securityRouter)
  return app
}

/** Pin the auth-experience flag; records every evaluation so defaults can be asserted. */
function pinFlag(on: boolean) {
  const getBooleanValue = jest.fn(async (key: string) => (key === FLAGS.AUTH_EXPERIENCE ? on : false))
  setIdentityFlagClient({ getBooleanValue })
  return getBooleanValue
}

function stubSiteverify() {
  const fetchMock = jest.fn(async (_url: string, init: { body: string }) => {
    const secret = new URLSearchParams(init.body).get('secret') ?? ''
    return {
      ok: true,
      status: 200,
      json: async () => (secret.startsWith('1x') ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] }),
    } as unknown as Response
  })
  ;(global as any).fetch = fetchMock
  return fetchMock
}

const savedEnv = { ...process.env }
const realFetch = global.fetch

beforeEach(() => {
  delete process.env.TURNSTILE_SITE_KEY
  delete process.env.TURNSTILE_SECRET_KEY
})
afterEach(() => {
  setIdentityProvider(null)
  setIdentityFlagClient(null)
  process.env = { ...savedEnv }
  ;(global as any).fetch = realFetch
})

const signup = (app: express.Express, body: object) => request(app).post('/api/v1/security/signup').send(body)

// ───────────────────────────── flag defaults ──────────────────────────────

describe('fuzefront.auth.experience flag wiring', () => {
  it('is evaluated with a fail-safe default of OFF and the app/environment context', async () => {
    const flag = pinFlag(false)
    await request(makeApp(provider())).get('/api/v1/security/methods')
    const call = flag.mock.calls.find((c: any[]) => c[0] === 'fuzefront.auth.experience') as any[]
    expect(call).toBeDefined()
    expect(call[1]).toBe(false) // in-code default = OFF (release flag)
    expect(call[2]).toMatchObject({ app: 'security-service' })
  })

  it('a flag-client outage fails safe to the OFF (legacy) behaviour', async () => {
    setIdentityFlagClient({ getBooleanValue: async () => { throw new Error('unleash down') } })
    const p = provider()
    const res = await signup(makeApp(p), { email: 'a@b.co', password: 'pw', firstName: 'Old', lastName: 'Shape' })
    expect(res.status).toBe(201)
  })
})

// ───────────────────────────── POST /signup ───────────────────────────────

describe('POST /signup — flag OFF (legacy behaviour, unchanged)', () => {
  beforeEach(() => { pinFlag(false) })

  it('honours legacy firstName/lastName by mapping them to the single `name`', async () => {
    const p = provider()
    const res = await signup(makeApp(p), { email: 'a@b.co', password: 'pw', firstName: 'Ada', lastName: 'Lovelace', tenantName: 'T' })
    expect(res.status).toBe(201)
    expect(p.signup).toHaveBeenCalledWith(
      { email: 'a@b.co', password: 'pw', name: 'Ada Lovelace', tenantName: 'T' },
      expect.anything()
    )
  })

  it('accepts a single `name` too (new client against a dark backend)', async () => {
    const p = provider()
    const res = await signup(makeApp(p), { email: 'a@b.co', password: 'pw', name: '  王小明 ' })
    expect(res.status).toBe(201)
    expect((p.signup as jest.Mock).mock.calls[0][0].name).toBe('王小明')
  })

  it('does NOT enforce the password policy (a weak password reaches the provider)', async () => {
    const p = provider()
    const res = await signup(makeApp(p), { email: 'a@b.co', password: 'pw' })
    expect(res.status).toBe(201)
    expect(p.signup).toHaveBeenCalledTimes(1)
  })

  it('does NOT require or verify a captcha even when Turnstile is configured', async () => {
    process.env.TURNSTILE_SITE_KEY = SITE_KEY
    process.env.TURNSTILE_SECRET_KEY = SECRET_FAIL
    const fetchMock = stubSiteverify()
    const res = await signup(makeApp(provider()), { email: 'a@b.co', password: 'pw' })
    expect(res.status).toBe(201)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not reject unknown fields', async () => {
    const res = await signup(makeApp(provider()), { email: 'a@b.co', password: 'pw', somethingElse: 1 })
    expect(res.status).toBe(201)
  })
})

describe('POST /signup — flag ON (1.0.0 contract)', () => {
  beforeEach(() => { pinFlag(true) })

  describe('name mapping', () => {
    it('passes the single `name` straight through to the provider', async () => {
      const p = provider()
      const res = await signup(makeApp(p), { email: 'a@b.co', password: STRONG, name: 'Ada Lovelace' })
      expect(res.status).toBe(201)
      expect(p.signup).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'a@b.co', password: STRONG, name: 'Ada Lovelace' }),
        expect.anything()
      )
    })

    it.each([['王 小明'], ['Sukarno'], ['محمد علي']])('does not split or reorder %s', async (name) => {
      const p = provider()
      await signup(makeApp(p), { email: 'a@b.co', password: STRONG, name })
      expect((p.signup as jest.Mock).mock.calls[0][0].name).toBe(name)
    })

    it('name is optional (omitted -> undefined, not a join of blanks)', async () => {
      const p = provider()
      const res = await signup(makeApp(p), { email: 'a@b.co', password: STRONG })
      expect(res.status).toBe(201)
      expect((p.signup as jest.Mock).mock.calls[0][0].name).toBeUndefined()
    })

    it('legacy firstName/lastName are rejected (additionalProperties:false)', async () => {
      const p = provider()
      const res = await signup(makeApp(p), { email: 'a@b.co', password: STRONG, firstName: 'Ada', lastName: 'L' })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('MALFORMED')
      expect(p.signup).not.toHaveBeenCalled()
    })

    it('rejects a non-string or over-long name', async () => {
      const p = provider()
      expect((await signup(makeApp(p), { email: 'a@b.co', password: STRONG, name: 5 })).status).toBe(400)
      expect((await signup(makeApp(p), { email: 'a@b.co', password: STRONG, name: 'x'.repeat(256) })).status).toBe(400)
      expect(p.signup).not.toHaveBeenCalled()
    })
  })

  describe('input validation', () => {
    it('rejects a malformed email / missing password with 400 MALFORMED', async () => {
      const p = provider()
      const app = makeApp(p)
      expect((await signup(app, { email: 'nope', password: STRONG })).status).toBe(400)
      expect((await signup(app, { email: 'a@b.co' })).status).toBe(400)
      expect((await signup(app, {})).status).toBe(400)
      expect(p.signup).not.toHaveBeenCalled()
    })
  })

  describe('password policy enforcement', () => {
    it('accepts a compliant password', async () => {
      const res = await signup(makeApp(provider()), { email: 'a@b.co', password: STRONG })
      expect(res.status).toBe(201)
    })

    it.each([
      ['too short', 'Ab1!'],
      ['no uppercase', 'correct-horse-9'],
      ['no lowercase', 'CORRECT-HORSE-9'],
      ['no digit', 'Correct-Horse-x'],
      ['no symbol', 'CorrectHorse99'],
    ])('rejects a weak password (%s) with 422 PASSWORD_POLICY before touching the provider', async (_l, password) => {
      const p = provider()
      const res = await signup(makeApp(p), { email: 'a@b.co', password })
      expect(res.status).toBe(422)
      expect(res.type).toMatch(/json/)
      expect(res.body.code).toBe('PASSWORD_POLICY')
      expect(typeof res.body.error).toBe('string')
      expect(res.body.error).not.toContain(password)
      expect(p.signup).not.toHaveBeenCalled()
    })

    it('the weak-password error is distinct from email-exists (409) and provider-unavailable (503)', async () => {
      const weak = await signup(makeApp(provider()), { email: 'a@b.co', password: 'weak' })

      const conflict = await signup(makeApp(provider({ signup: jest.fn().mockRejectedValue(new ConflictError()) })), {
        email: 'a@b.co', password: STRONG,
      })

      const unavailable = Object.assign(new Error('down'), { name: 'AuthentikUnavailableError' })
      const down = await signup(makeApp(provider({ signup: jest.fn().mockRejectedValue(unavailable) })), {
        email: 'a@b.co', password: STRONG,
      })

      expect([weak.status, conflict.status, down.status]).toEqual([422, 409, 503])
      expect(weak.body.code).toBe('PASSWORD_POLICY')
      expect(conflict.body.code).toBe('CONFLICT')
      expect(down.body.code).toBe('PROVIDER_UNAVAILABLE')
    })
  })

  describe('Turnstile verification', () => {
    it('captcha NOT configured: no token required and Cloudflare is never called', async () => {
      const fetchMock = stubSiteverify()
      const res = await signup(makeApp(provider()), { email: 'a@b.co', password: STRONG })
      expect(res.status).toBe(201)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    describe('captcha configured (Cloudflare test keys)', () => {
      beforeEach(() => {
        process.env.TURNSTILE_SITE_KEY = SITE_KEY
        process.env.TURNSTILE_SECRET_KEY = SECRET_PASS
      })

      it('valid token -> 201, and the provider is called', async () => {
        const fetchMock = stubSiteverify()
        const p = provider()
        const res = await signup(makeApp(p), { email: 'a@b.co', password: STRONG, turnstileToken: TOKEN })
        expect(res.status).toBe(201)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(p.signup).toHaveBeenCalledTimes(1)
        // turnstileToken is verification-only — it must not leak into the provider input.
        expect((p.signup as jest.Mock).mock.calls[0][0]).not.toHaveProperty('turnstileToken')
      })

      it('missing token -> 400 and no enrollment', async () => {
        const fetchMock = stubSiteverify()
        const p = provider()
        const res = await signup(makeApp(p), { email: 'a@b.co', password: STRONG })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('CAPTCHA_FAILED')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(p.signup).not.toHaveBeenCalled()
      })

      it('token Cloudflare rejects (always-fail secret) -> 400 and no enrollment', async () => {
        process.env.TURNSTILE_SECRET_KEY = SECRET_FAIL
        stubSiteverify()
        const p = provider()
        const res = await signup(makeApp(p), { email: 'a@b.co', password: STRONG, turnstileToken: TOKEN })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('CAPTCHA_FAILED')
        expect(p.signup).not.toHaveBeenCalled()
      })

      it('Cloudflare unreachable -> 503 PROVIDER_UNAVAILABLE + Retry-After (fail closed)', async () => {
        ;(global as any).fetch = jest.fn().mockRejectedValue(new Error('network'))
        const p = provider()
        const res = await signup(makeApp(p), { email: 'a@b.co', password: STRONG, turnstileToken: TOKEN })
        expect(res.status).toBe(503)
        expect(res.body.code).toBe('PROVIDER_UNAVAILABLE')
        expect(res.headers['retry-after']).toBeDefined()
        expect(p.signup).not.toHaveBeenCalled()
      })

      it('a weak password is rejected BEFORE the single-use token is spent', async () => {
        const fetchMock = stubSiteverify()
        const res = await signup(makeApp(provider()), { email: 'a@b.co', password: 'weak', turnstileToken: TOKEN })
        expect(res.status).toBe(422)
        expect(fetchMock).not.toHaveBeenCalled()
      })

      it('the response never contains the secret', async () => {
        stubSiteverify()
        const res = await signup(makeApp(provider()), { email: 'a@b.co', password: STRONG, turnstileToken: TOKEN })
        expect(JSON.stringify(res.body)).not.toContain(SECRET_PASS)
      })
    })
  })
})

// ───────────────────────────── GET /methods ───────────────────────────────

describe('GET /methods — passwordPolicy + captcha', () => {
  const methods = () => request(makeApp(provider())).get('/api/v1/security/methods')

  it('flag OFF: neither passwordPolicy nor captcha is advertised', async () => {
    pinFlag(false)
    process.env.TURNSTILE_SITE_KEY = SITE_KEY
    process.env.TURNSTILE_SECRET_KEY = SECRET_PASS
    const res = await methods()
    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('passwordPolicy')
    expect(res.body).not.toHaveProperty('captcha')
  })

  it('flag ON: serves the authoritative password policy', async () => {
    pinFlag(true)
    const res = await methods()
    expect(res.status).toBe(200)
    expect(res.body.passwordPolicy).toEqual({
      minLength: 12,
      requireUpper: true,
      requireLower: true,
      requireDigit: true,
      requireSymbol: true,
    })
  })

  it('flag ON, captcha NOT configured: captcha is absent', async () => {
    pinFlag(true)
    const res = await methods()
    expect(res.body).not.toHaveProperty('captcha')
  })

  it('flag ON, captcha configured: serves { provider, siteKey } and never the secret', async () => {
    pinFlag(true)
    process.env.TURNSTILE_SITE_KEY = SITE_KEY
    process.env.TURNSTILE_SECRET_KEY = SECRET_PASS
    const res = await methods()
    expect(res.body.captcha).toEqual({ provider: 'turnstile', siteKey: SITE_KEY })
    expect(JSON.stringify(res.body)).not.toContain(SECRET_PASS)
  })

  it('flag ON, site key without secret: captcha is NOT advertised (would be unverifiable)', async () => {
    pinFlag(true)
    process.env.TURNSTILE_SITE_KEY = SITE_KEY
    const res = await methods()
    expect(res.body).not.toHaveProperty('captcha')
  })

  it('the existing descriptor fields are untouched in both states', async () => {
    for (const on of [false, true]) {
      pinFlag(on)
      const res = await methods()
      expect(res.body).toMatchObject({ password: true, mfa: { enabled: true }, verification: expect.any(Object) })
    }
  })
})

// ───────────────────── GET /signup/email-available (alias) ─────────────────────

describe('GET /signup/email-available — alias of the live availability handler', () => {
  const alias = (app: express.Express, email?: string) =>
    request(app).get('/api/v1/security/signup/email-available').query(email === undefined ? {} : { email })

  it('flag OFF: dark (404), provider never consulted', async () => {
    pinFlag(false)
    const p = provider()
    const res = await alias(makeApp(p), 'a@b.co')
    expect(res.status).toBe(404)
    expect(p.emailExists).not.toHaveBeenCalled()
  })

  describe('flag ON', () => {
    beforeEach(() => { pinFlag(true) })

    it('available -> 200 { available:true } (exactly the contract shape, no echoed email)', async () => {
      const res = await alias(makeApp(provider({ emailExists: jest.fn().mockResolvedValue(false) })), 'fresh@example.com')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ available: true })
    })

    it('taken -> 200 { available:false }', async () => {
      const res = await alias(makeApp(provider({ emailExists: jest.fn().mockResolvedValue(true) })), 'taken@example.com')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ available: false })
    })

    it('normalizes (trim + lowercase) before checking, like the live endpoint', async () => {
      const p = provider()
      await alias(makeApp(p), '  Alice@Example.COM ')
      expect(p.emailExists).toHaveBeenCalledWith('alice@example.com')
    })

    it('malformed / missing email -> 400 MALFORMED without consulting the provider', async () => {
      const p = provider()
      const app = makeApp(p)
      expect((await alias(app, 'not-an-email')).status).toBe(400)
      const missing = await alias(app)
      expect(missing.status).toBe(400)
      expect(missing.body.code).toBe('MALFORMED')
      expect(p.emailExists).not.toHaveBeenCalled()
    })

    it('FAIL-OPEN: a provider error answers 200 { available:true }, never a 5xx', async () => {
      const p = provider({ emailExists: jest.fn().mockRejectedValue(new Error('db down')) })
      const res = await alias(makeApp(p), 'a@b.co')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ available: true })
    })

    it('shares one source of truth with the live endpoint (same emailExists, same answer)', async () => {
      const p = provider({ emailExists: jest.fn().mockResolvedValue(true) })
      const app = makeApp(p)
      const live = await request(app).get('/api/v1/security/email-available').query({ email: 'x@y.co' })
      const aliasRes = await alias(app, 'x@y.co')
      expect(live.body.available).toBe(false)
      expect(aliasRes.body.available).toBe(false)
      expect(p.emailExists).toHaveBeenCalledTimes(2)
    })

    it('the live endpoint keeps its { available, email } shape and non-fail-open error posture', async () => {
      const ok = await request(makeApp(provider())).get('/api/v1/security/email-available').query({ email: 'Z@Y.co' })
      expect(ok.body).toEqual({ available: true, email: 'z@y.co' })

      const down = await request(makeApp(provider({ emailExists: jest.fn().mockRejectedValue(new Error('boom')) })))
        .get('/api/v1/security/email-available')
        .query({ email: 'z@y.co' })
      expect(down.status).not.toBe(200)
    })

    it('is per-IP rate-limited, on ONE budget shared with the live endpoint -> 429', async () => {
      // Alternate paths: if the counters were separate neither would trip within 24 hits.
      const app = makeApp(provider())
      let saw429 = false
      for (let i = 0; i < 40 && !saw429; i++) {
        const path = i % 2 === 0 ? '/api/v1/security/signup/email-available' : '/api/v1/security/email-available'
        const res = await request(app).get(path).query({ email: 'loop@example.com' })
        if (res.status === 429) {
          saw429 = true
          expect(res.body.code).toBe('RATE_LIMITED')
        }
      }
      expect(saw429).toBe(true)
    })
  })
})
