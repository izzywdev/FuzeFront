/**
 * Unit tests for GET /api/v1/security/email-available.
 *
 * The public inline signup-availability check. Tested against a FAKE
 * `IdentityProvider` injected via `setIdentityProvider`, so these assert the
 * HTTP contract (normalization, validation, the { available, email } envelope,
 * and the per-IP rate-limit guard) independent of the concrete provider.
 */
import express from 'express'
import request from 'supertest'
import securityRouter from '../src/routes/security'
import { setIdentityProvider } from '../src/providers/factory'
import type { IdentityProvider } from '../src/providers/IdentityProvider'

function fakeProvider(exists: boolean | ((email: string) => boolean)): IdentityProvider {
  const emailExists = jest.fn(async (email: string) =>
    typeof exists === 'function' ? exists(email) : exists
  )
  return { emailExists } as unknown as IdentityProvider
}

function makeApp(p: IdentityProvider) {
  setIdentityProvider(p)
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', securityRouter)
  return app
}

afterEach(() => setIdentityProvider(null))

describe('GET /email-available', () => {
  it('200 { available:true } when no account exists', async () => {
    const p = fakeProvider(false)
    const res = await request(makeApp(p)).get('/api/v1/security/email-available?email=fresh@example.com')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ available: true, email: 'fresh@example.com' })
  })

  it('200 { available:false } when an account already exists', async () => {
    const p = fakeProvider(true)
    const res = await request(makeApp(p)).get('/api/v1/security/email-available?email=taken@example.com')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ available: false, email: 'taken@example.com' })
  })

  it('normalizes (trims + lowercases) before checking and echoes the normalized email', async () => {
    const p = fakeProvider(false)
    const res = await request(makeApp(p)).get(
      `/api/v1/security/email-available?email=${encodeURIComponent('  Alice@Example.COM  ')}`
    )
    expect(res.status).toBe(200)
    expect(res.body.email).toBe('alice@example.com')
    expect(p.emailExists).toHaveBeenCalledWith('alice@example.com')
  })

  it('400 on a malformed email', async () => {
    const p = fakeProvider(false)
    const res = await request(makeApp(p)).get('/api/v1/security/email-available?email=not-an-email')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('MALFORMED')
    expect(p.emailExists).not.toHaveBeenCalled()
  })

  it('400 when the email param is missing', async () => {
    const p = fakeProvider(false)
    const res = await request(makeApp(p)).get('/api/v1/security/email-available')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('MALFORMED')
  })

  it('429 once the per-IP rate limit is exceeded (enumeration guard)', async () => {
    // Limit is 20/min/IP. supertest reuses one ephemeral client port per call,
    // but req.ip resolves to the loopback address for all of them, so the 21st
    // request within the window trips the limiter.
    const app = makeApp(fakeProvider(false))
    let sawRateLimit = false
    for (let i = 0; i < 25; i++) {
      const res = await request(app).get('/api/v1/security/email-available?email=loop@example.com')
      if (res.status === 429) {
        sawRateLimit = true
        expect(res.body.code).toBe('RATE_LIMITED')
        break
      }
    }
    expect(sawRateLimit).toBe(true)
  })
})
