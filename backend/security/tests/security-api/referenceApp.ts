/**
 * referenceApp.ts — a THIN Express app that maps the frozen Security API spec
 * onto ANY `IdentityProvider`. It exists purely as a test fixture ("contract
 * mock until the real impl lands"), so the independent suite has something to
 * run its spec assertions against, and so the provider-swap proof can drive the
 * full AuthN surface through the neutral interface.
 *
 * It deliberately implements ONLY the AuthN slice this suite owns
 * (session/social/signup/methods/mfa/verify/tokens). AuthZ + tenant routes are
 * out of scope for this suite.
 *
 * NOTE: This is NOT the product. When the real backend lands, set
 * SECURITY_BASE_URL to run the identical assertions against it (see harness.ts).
 */
import express, { Request, Response, NextFunction } from 'express'
import { IdentityProvider } from '../../src/providers/IdentityProvider'
import { MockIdentityProvider, ProviderError } from './mockIdentityProvider'

const CODE_TO_STATUS: Record<string, number> = {
  NO_TOKEN: 401,
  MALFORMED: 400,
  INVALID_SIGNATURE: 401,
  EXPIRED: 401,
  NOT_ACTIVE: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_CODE: 401,
  CONFLICT: 409,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PROVIDER_UNAVAILABLE: 503,
  UNKNOWN: 500,
}

function sendError(res: Response, code: string, error: string, statusOverride?: number) {
  const status = statusOverride ?? CODE_TO_STATUS[code] ?? 500
  res.status(status).json({ error, code })
}

function bearer(req: Request): string | null {
  const h = req.header('authorization') || ''
  const m = /^Bearer (.+)$/.exec(h)
  return m ? m[1] : null
}

function handle(res: Response, e: unknown) {
  if (e instanceof ProviderError) return sendError(res, e.code, e.message, e.httpStatus)
  return sendError(res, 'UNKNOWN', 'unexpected error', 500)
}

export function createSecurityApp(provider: IdentityProvider = new MockIdentityProvider()) {
  const app = express()
  app.use(express.json())
  const mock = provider as MockIdentityProvider // for MFA-branch helpers on the fixture

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const token = bearer(req)
    if (!token) return sendError(res, 'NO_TOKEN', 'missing bearer token')
    ;(req as any).token = token
    next()
  }

  // ── session ──────────────────────────────────────────────────────────────
  app.post('/api/v1/security/session', async (req, res) => {
    const { email, password } = req.body || {}
    if (typeof email !== 'string' || typeof password !== 'string') {
      return sendError(res, 'MALFORMED', 'email and password required', 400)
    }
    try {
      if (typeof mock.requiresMfa === 'function' && mock.requiresMfa(email)) {
        // Validate credentials still (fail-closed) before opening a challenge.
        try {
          await provider.passwordLogin({ email, password })
        } catch (e) {
          return handle(res, e)
        }
        const { challengeId, factors } = mock.openMfaChallenge(email)
        return res.status(200).json({
          status: 'mfa_required',
          challengeId,
          factors: factors.map((f) => ({ factorId: f.factorId, type: f.type })),
        })
      }
      const s = await provider.passwordLogin({ email, password })
      return res.status(200).json({ status: 'authenticated', ...s })
    } catch (e) {
      handle(res, e)
    }
  })

  app.get('/api/v1/security/session', requireAuth, async (req, res) => {
    try {
      const info = await provider.getUserInfo((req as any).token)
      res.status(200).json(info)
    } catch (e) {
      handle(res, e)
    }
  })

  app.delete('/api/v1/security/session', requireAuth, async (req, res) => {
    try {
      await provider.logout((req as any).token)
      res.status(204).end()
    } catch (e) {
      handle(res, e)
    }
  })

  app.post('/api/v1/security/session/exchange', async (req, res) => {
    const { code } = req.body || {}
    if (typeof code !== 'string') return sendError(res, 'MALFORMED', 'code required', 400)
    try {
      const s = await provider.exchangeCode(code)
      res.status(200).json({ status: 'authenticated', ...s })
    } catch (e) {
      handle(res, e)
    }
  })

  // ── social ───────────────────────────────────────────────────────────────
  app.get('/api/v1/security/social/:provider/start', async (req, res) => {
    const redirectTo = typeof req.query.redirectTo === 'string' ? req.query.redirectTo : undefined
    if (redirectTo && /^https?:\/\//i.test(redirectTo)) {
      return sendError(res, 'MALFORMED', 'redirectTo must be same-origin', 400)
    }
    try {
      const start = await provider.startSocialLogin(req.params.provider, redirectTo)
      res.redirect(302, start.redirectUrl)
    } catch (e) {
      handle(res, e)
    }
  })

  app.get('/api/v1/security/social/callback', async (req, res) => {
    const { code, state } = req.query
    if (typeof code !== 'string' || typeof state !== 'string') {
      return sendError(res, 'INVALID_CODE', 'code and state required', 401)
    }
    try {
      const result = await provider.brokerCallback({ code, state })
      const loc = `${result.redirectTo}?code=${encodeURIComponent(result.code)}`
      res.redirect(302, loc)
    } catch (e) {
      handle(res, e)
    }
  })

  // ── signup ───────────────────────────────────────────────────────────────
  app.post('/api/v1/security/signup', async (req, res) => {
    const { email, password } = req.body || {}
    if (typeof email !== 'string' || typeof password !== 'string') {
      return sendError(res, 'MALFORMED', 'email and password required', 400)
    }
    try {
      const s = await provider.signup(req.body)
      res.status(201).json({ token: s.token, sessionId: s.sessionId, user: s.user })
    } catch (e) {
      handle(res, e)
    }
  })

  // ── methods ──────────────────────────────────────────────────────────────
  app.get('/api/v1/security/methods', async (_req, res) => {
    res.status(200).json({
      password: true,
      social: ['google'],
      mfa: { enabled: true, types: ['totp', 'sms', 'email'] },
      verification: { email: true, sms: true },
    })
  })

  // ── mfa: factors ───────────────────────────────────────────────────────────
  app.get('/api/v1/security/mfa/factors', requireAuth, async (req, res) => {
    try {
      const items = await provider.listFactors((req as any).token)
      res.status(200).json({ items })
    } catch (e) {
      handle(res, e)
    }
  })

  app.post('/api/v1/security/mfa/factors', requireAuth, async (req, res) => {
    const { type } = req.body || {}
    if (!['totp', 'sms', 'email', 'webauthn'].includes(type)) {
      return sendError(res, 'MALFORMED', 'valid type required', 400)
    }
    try {
      const result = await provider.enrollFactor((req as any).token, req.body)
      res.status(201).json(result)
    } catch (e) {
      handle(res, e)
    }
  })

  app.post('/api/v1/security/mfa/factors/:factorId/activate', requireAuth, async (req, res) => {
    const { code } = req.body || {}
    if (typeof code !== 'string') return sendError(res, 'MALFORMED', 'code required', 400)
    try {
      const factor = await provider.activateFactor((req as any).token, req.params.factorId, code)
      res.status(200).json(factor)
    } catch (e) {
      handle(res, e)
    }
  })

  app.delete('/api/v1/security/mfa/factors/:factorId', requireAuth, async (req, res) => {
    try {
      await provider.removeFactor((req as any).token, req.params.factorId)
      res.status(204).end()
    } catch (e) {
      handle(res, e)
    }
  })

  app.post('/api/v1/security/mfa/recovery-codes', requireAuth, async (req, res) => {
    try {
      const codes = await provider.regenerateRecoveryCodes((req as any).token)
      res.status(200).json({ codes })
    } catch (e) {
      handle(res, e)
    }
  })

  // ── mfa: step-up ───────────────────────────────────────────────────────────
  app.post('/api/v1/security/mfa/challenge', async (req, res) => {
    const { challengeId, factorId } = req.body || {}
    if (typeof challengeId !== 'string' || typeof factorId !== 'string') {
      return sendError(res, 'MALFORMED', 'challengeId and factorId required', 400)
    }
    try {
      const ack = await provider.challengeMfa(challengeId, factorId)
      res.status(202).json(ack)
    } catch (e) {
      handle(res, e)
    }
  })

  app.post('/api/v1/security/mfa/verify', async (req, res) => {
    const { challengeId, factorId, code } = req.body || {}
    if (typeof challengeId !== 'string' || typeof factorId !== 'string' || typeof code !== 'string') {
      return sendError(res, 'MALFORMED', 'challengeId, factorId, code required', 400)
    }
    try {
      const s = await provider.verifyMfa(challengeId, factorId, code)
      res.status(200).json({ token: s.token, sessionId: s.sessionId, user: s.user })
    } catch (e) {
      handle(res, e)
    }
  })

  // ── m2m tokens ─────────────────────────────────────────────────────────────
  app.post('/api/v1/security/tokens', async (req, res) => {
    const { clientId, clientSecret } = req.body || {}
    if (typeof clientId !== 'string' || typeof clientSecret !== 'string') {
      return sendError(res, 'MALFORMED', 'clientId and clientSecret required', 400)
    }
    try {
      const t = await provider.issueM2MToken(req.body)
      res.status(200).json(t)
    } catch (e) {
      handle(res, e)
    }
  })

  app.post('/api/v1/security/tokens/introspect', async (req, res) => {
    const { token } = req.body || {}
    if (typeof token !== 'string') return sendError(res, 'MALFORMED', 'token required', 400)
    try {
      const result = await provider.introspectToken(token)
      res.status(200).json(result) // fail-closed → { active: false }, still 200
    } catch (e) {
      handle(res, e)
    }
  })

  // ── contact verification ────────────────────────────────────────────────────
  app.post('/api/v1/security/verify/email/start', async (req, res) => {
    const token = bearer(req)
    const email = req.body?.email
    try {
      await provider.startEmailVerification(token, email)
      res.status(202).end()
    } catch (e) {
      handle(res, e)
    }
  })

  app.post('/api/v1/security/verify/email/confirm', async (req, res) => {
    try {
      const status = await provider.confirmEmailVerification(req.body || {})
      res.status(200).json(status)
    } catch (e) {
      handle(res, e)
    }
  })

  app.post('/api/v1/security/verify/phone/start', requireAuth, async (req, res) => {
    const { phone } = req.body || {}
    if (typeof phone !== 'string') return sendError(res, 'MALFORMED', 'phone required', 400)
    try {
      await provider.startPhoneVerification((req as any).token, phone)
      res.status(202).end()
    } catch (e) {
      handle(res, e)
    }
  })

  app.post('/api/v1/security/verify/phone/confirm', async (req, res) => {
    const { phone, code } = req.body || {}
    if (typeof phone !== 'string' || typeof code !== 'string') {
      return sendError(res, 'MALFORMED', 'phone and code required', 400)
    }
    try {
      const status = await provider.confirmPhoneVerification(phone, code)
      res.status(200).json(status)
    } catch (e) {
      handle(res, e)
    }
  })

  app.get('/api/v1/security/verify/status', requireAuth, async (req, res) => {
    try {
      const status = await provider.getVerificationStatus((req as any).token)
      res.status(200).json(status)
    } catch (e) {
      handle(res, e)
    }
  })

  return app
}
