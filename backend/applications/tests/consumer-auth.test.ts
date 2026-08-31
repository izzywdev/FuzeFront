// Unit tests for authenticateConsumerOrSession's fail-CLOSED behaviour.
//
// Before this fix, an absent or mismatched CONSUMER_REGISTRATION_SECRET
// silently fell through to authenticateToken (plain JWT validation), which
// rejected the request with a generic "Invalid token." 401 — giving an
// operator debugging a consumer's CrashLoopBackOff pod no signal that the
// *server* has no registration secret configured. See
// docs/mfe-self-registration.md "Diagnosing a 401" and the header comment on
// backend/applications/src/middleware/consumer-auth.ts.
//
// These tests assert the middleware now fails closed and distinguishably:
//   - correct pre-shared token           -> synthetic consumer user, next()
//   - wrong pre-shared token             -> 401 invalid_registration_token
//   - secret unset on the pod            -> 503 consumer_registration_unavailable
//   - JWT-shaped bearer (human session)  -> falls through to authenticateToken,
//                                            completely unaffected
import type { Request, Response } from 'express'

jest.mock('../src/middleware/auth', () => ({
  authenticateToken: jest.fn((_req: any, res: any, next: any) => {
    // Stand-in for the real JWT path: this test only needs to prove that
    // JWT-shaped bearers (and requests with no Authorization header) still
    // reach here, not that JWT verification itself works.
    res.__reachedAuthenticateToken = true
    next()
  }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { authenticateConsumerOrSession } = require('../src/middleware/consumer-auth')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { authenticateToken } = require('../src/middleware/auth')

const CONSUMER_SECRET = 'a'.repeat(64) // shape of `openssl rand -hex 32`

function buildReq(authHeader?: string): Request & { user?: unknown } {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as any
}

function buildRes(): Response & { statusCode?: number; body?: unknown } {
  const res: any = {}
  res.status = jest.fn((code: number) => {
    res.statusCode = code
    return res
  })
  res.json = jest.fn((body: unknown) => {
    res.body = body
    return res
  })
  return res
}

describe('authenticateConsumerOrSession — fail-closed consumer auth', () => {
  const originalSecret = process.env.CONSUMER_REGISTRATION_SECRET

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CONSUMER_REGISTRATION_SECRET
    else process.env.CONSUMER_REGISTRATION_SECRET = originalSecret
    jest.clearAllMocks()
  })

  it('accepts the correct pre-shared token and attaches the synthetic consumer user', () => {
    process.env.CONSUMER_REGISTRATION_SECRET = CONSUMER_SECRET
    const req = buildReq(`Bearer ${CONSUMER_SECRET}`)
    const res = buildRes()
    const next = jest.fn()

    authenticateConsumerOrSession(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect((req as any).user).toMatchObject({ id: 'consumer-registration', roles: ['admin'] })
    expect(res.status).not.toHaveBeenCalled()
    expect(authenticateToken).not.toHaveBeenCalled()
  })

  it('rejects a wrong (but correctly configured) pre-shared token with a deliberate 401', () => {
    process.env.CONSUMER_REGISTRATION_SECRET = CONSUMER_SECRET
    const req = buildReq(`Bearer ${'b'.repeat(64)}`)
    const res = buildRes()
    const next = jest.fn()

    authenticateConsumerOrSession(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(authenticateToken).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.body).toMatchObject({ error: 'invalid_registration_token' })
  })

  it('FAILS CLOSED when CONSUMER_REGISTRATION_SECRET is unset — does NOT fall through to session auth', () => {
    delete process.env.CONSUMER_REGISTRATION_SECRET
    const req = buildReq(`Bearer ${CONSUMER_SECRET}`)
    const res = buildRes()
    const next = jest.fn()

    authenticateConsumerOrSession(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(authenticateToken).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.body).toMatchObject({ error: 'consumer_registration_unavailable' })
  })

  it('lets a JWT-shaped bearer token fall through to ordinary session auth, secret set or not', () => {
    process.env.CONSUMER_REGISTRATION_SECRET = CONSUMER_SECRET
    const jwtShaped = 'header.payload.signature'
    const req = buildReq(`Bearer ${jwtShaped}`)
    const res: any = buildRes()
    const next = jest.fn()

    authenticateConsumerOrSession(req, res, next)

    expect(authenticateToken).toHaveBeenCalledTimes(1)
    expect(res.__reachedAuthenticateToken).toBe(true)
  })

  it('lets a request with no Authorization header fall through to ordinary session auth', () => {
    process.env.CONSUMER_REGISTRATION_SECRET = CONSUMER_SECRET
    const req = buildReq(undefined)
    const res: any = buildRes()
    const next = jest.fn()

    authenticateConsumerOrSession(req, res, next)

    expect(authenticateToken).toHaveBeenCalledTimes(1)
    expect(res.__reachedAuthenticateToken).toBe(true)
  })
})
