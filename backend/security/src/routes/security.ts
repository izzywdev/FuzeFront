/**
 * The FuzeFront Security API — AuthN surface under `/api/v1/security`.
 *
 * Implemented PURELY against the neutral `IdentityProvider` contract (via the
 * env-driven factory) — no vendor is named here. Request/response shapes match
 * the frozen OpenAPI (`packages/security/openapi.yaml`) and the generated
 * `@fuzefront/security-client` types. Fail-closed throughout.
 *
 * AuthZ endpoints (`/authz/*`, `/tenants/*`) are a SEPARATE, later stream and
 * are intentionally not implemented in this AuthN slice.
 */
import express, { Request, Response } from 'express'
import { getIdentityProvider } from '../providers/factory'
import {
  MfaRequiredError,
  ConflictError,
  InvalidInputError,
  UnauthorizedError,
} from '../providers/authentik/AuthentikIdentityProvider'
import { appBaseUrl } from '../providers/authentik/config'
import type { BrokeredSession, BrokeredUser } from '../providers/IdentityProvider'

const router = express.Router()

// ── Helpers ─────────────────────────────────────────────────────────────────
function bearer(req: Request): string | null {
  const h = req.headers['authorization']
  if (!h || Array.isArray(h)) return null
  const [scheme, token] = h.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

function toApiUser(u: BrokeredUser) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    defaultAppId: u.defaultAppId,
    roles: u.roles,
  }
}

function authenticatedSession(session: BrokeredSession) {
  return {
    status: 'authenticated' as const,
    token: session.token,
    sessionId: session.sessionId,
    user: toApiUser(session.user),
  }
}

/** Map a thrown provider error to a fail-closed HTTP response. */
function sendError(res: Response, err: unknown): void {
  if (err instanceof InvalidInputError) {
    res.status(400).json({ error: err.message, code: 'MALFORMED' })
    return
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message, code: 'CONFLICT' })
    return
  }
  if (err instanceof UnauthorizedError) {
    res.status(401).json({ error: err.message, code: 'NOT_ACTIVE' })
    return
  }
  const name = (err as Error)?.name
  if (name === 'InvalidCredentialsError') {
    res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    return
  }
  if (name === 'AuthentikUnavailableError' || name === 'UnsupportedFlowStageError') {
    res.status(401).json({ error: 'Authentication unavailable', code: 'PROVIDER_UNAVAILABLE' })
    return
  }
  console.error('[security] unhandled error:', err)
  res.status(401).json({ error: 'Authentication failed', code: 'UNKNOWN' })
}

/** Require a bearer token; returns it or sends 401 and returns null. */
function requireBearer(req: Request, res: Response): string | null {
  const token = bearer(req)
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token', code: 'NO_TOKEN' })
    return null
  }
  return token
}

// ── Session lifecycle ─────────────────────────────────────────────────────
// POST /v1/security/session — password login
router.post('/session', async (req: Request, res: Response) => {
  try {
    const session = await getIdentityProvider().passwordLogin({
      email: req.body?.email,
      password: req.body?.password,
    })
    res.status(200).json(authenticatedSession(session))
  } catch (err) {
    if (err instanceof MfaRequiredError) {
      res.status(200).json({ status: 'mfa_required', challengeId: err.challengeId, factors: err.factors })
      return
    }
    sendError(res, err)
  }
})

// GET /v1/security/session — current identity ("me")
router.get('/session', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    const { identity, user } = await getIdentityProvider().getUserInfo(token)
    res.status(200).json({ identity, user: toApiUser(user) })
  } catch (err) {
    sendError(res, err)
  }
})

// DELETE /v1/security/session — logout
router.delete('/session', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    await getIdentityProvider().logout(token)
    res.status(204).end()
  } catch (err) {
    sendError(res, err)
  }
})

// POST /v1/security/session/exchange — exchange opaque broker code
router.post('/session/exchange', async (req: Request, res: Response) => {
  try {
    if (!req.body?.code || typeof req.body.code !== 'string') {
      throw new InvalidInputError('code is required')
    }
    const session = await getIdentityProvider().exchangeCode(req.body.code)
    res.status(200).json(authenticatedSession(session))
  } catch (err) {
    if (err instanceof MfaRequiredError) {
      res.status(200).json({ status: 'mfa_required', challengeId: err.challengeId, factors: err.factors })
      return
    }
    sendError(res, err)
  }
})

// ── Social login (server-brokered) ─────────────────────────────────────────
// GET /v1/security/social/{provider}/start — 302 to the provider via same-host IdP path
router.get('/social/:provider/start', async (req: Request, res: Response) => {
  try {
    const redirectTo = typeof req.query.redirectTo === 'string' ? req.query.redirectTo : '/'
    const { redirectUrl, state, codeVerifier } = await getIdentityProvider().startSocialLogin(req.params.provider, redirectTo)
    // The authorize URL's redirect_uri is the OIDC client's registered callback
    // (`/api/auth/oidc/callback`), so the browser returns THERE after Google
    // consent. That handler is replica-agnostic via the oidc_state + oidc_cv
    // cookies — set them here (same names/semantics as /api/auth/oidc/login) so
    // the exchange completes and mints the shared opaque ?code= the SPA redeems
    // at /api/v1/security/session/exchange. `sec_social_state` is retained for
    // the (non-default) brokerCallback path.
    res.setHeader('Set-Cookie', [
      `oidc_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
      `oidc_cv=${codeVerifier}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
      `sec_social_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    ])
    res.redirect(302, redirectUrl)
  } catch (err) {
    sendError(res, err)
  }
})

// GET /v1/security/social/callback — broker callback, 302 back to app with ?code=
router.get('/social/callback', async (req: Request, res: Response) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    if (!code || !state) throw new InvalidInputError('code and state are required')
    const result = await getIdentityProvider().brokerCallback({ code, state })
    // Clear the state cookie; append the FuzeFront opaque code (never a token).
    res.setHeader('Set-Cookie', ['sec_social_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/'])
    const sep = result.redirectTo.includes('?') ? '&' : '?'
    const dest = `${appBaseUrl()}${result.redirectTo}${sep}code=${encodeURIComponent(result.code)}`
    res.redirect(302, dest)
  } catch (err) {
    // Fail-closed: send the browser back to the app with a neutral error.
    res.setHeader('Set-Cookie', ['sec_social_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/'])
    res.redirect(302, `${appBaseUrl()}/?error=authentication_failed`)
  }
})

// ── Signup ──────────────────────────────────────────────────────────────────
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const session = await getIdentityProvider().signup({
      email: req.body?.email,
      password: req.body?.password,
      firstName: req.body?.firstName,
      lastName: req.body?.lastName,
      tenantName: req.body?.tenantName,
    })
    res.status(201).json({ token: session.token, sessionId: session.sessionId, user: toApiUser(session.user) })
  } catch (err) {
    sendError(res, err)
  }
})

// ── Capabilities ──────────────────────────────────────────────────────────
router.get('/methods', (_req: Request, res: Response) => {
  // Neutral capability descriptor. Provider config decides what is enabled.
  const social: Array<'google'> = process.env.SECURITY_SOCIAL_GOOGLE === 'false' ? [] : ['google']
  res.status(200).json({
    password: true,
    social,
    mfa: { enabled: true, types: ['totp', 'sms', 'email'] },
    verification: { email: true, sms: true },
  })
})

// ── M2M tokens ──────────────────────────────────────────────────────────────
router.post('/tokens', async (req: Request, res: Response) => {
  try {
    if (!req.body?.clientId || !req.body?.clientSecret) {
      throw new InvalidInputError('clientId and clientSecret are required')
    }
    const t = await getIdentityProvider().issueM2MToken({
      clientId: req.body.clientId,
      clientSecret: req.body.clientSecret,
      scope: req.body.scope,
    })
    res.status(200).json(t)
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/tokens/introspect', async (req: Request, res: Response) => {
  try {
    if (!req.body?.token) throw new InvalidInputError('token is required')
    const r = await getIdentityProvider().introspectToken(req.body.token)
    res.status(200).json(r)
  } catch (err) {
    // Fail-closed: introspection never throws to the caller.
    res.status(200).json({ active: false })
  }
})

// ── MFA factor management ─────────────────────────────────────────────────
router.get('/mfa/factors', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    const items = await getIdentityProvider().listFactors(token)
    res.status(200).json({ items })
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/mfa/factors', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    const result = await getIdentityProvider().enrollFactor(token, {
      type: req.body?.type,
      phone: req.body?.phone,
      email: req.body?.email,
    })
    res.status(201).json(result)
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/mfa/factors/:factorId/activate', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    if (!req.body?.code) throw new InvalidInputError('code is required')
    const factor = await getIdentityProvider().activateFactor(token, req.params.factorId, req.body.code)
    res.status(200).json(factor)
  } catch (err) {
    sendError(res, err)
  }
})

router.delete('/mfa/factors/:factorId', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    await getIdentityProvider().removeFactor(token, req.params.factorId)
    res.status(204).end()
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/mfa/recovery-codes', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    const codes = await getIdentityProvider().regenerateRecoveryCodes(token)
    res.status(200).json({ codes })
  } catch (err) {
    sendError(res, err)
  }
})

// ── MFA login step-up ─────────────────────────────────────────────────────
router.post('/mfa/challenge', async (req: Request, res: Response) => {
  try {
    if (!req.body?.challengeId || !req.body?.factorId) {
      throw new InvalidInputError('challengeId and factorId are required')
    }
    const ack = await getIdentityProvider().challengeMfa(req.body.challengeId, req.body.factorId)
    res.status(202).json(ack)
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/mfa/verify', async (req: Request, res: Response) => {
  try {
    if (!req.body?.challengeId || !req.body?.factorId || !req.body?.code) {
      throw new InvalidInputError('challengeId, factorId and code are required')
    }
    const session = await getIdentityProvider().verifyMfa(req.body.challengeId, req.body.factorId, req.body.code)
    res.status(200).json({ token: session.token, sessionId: session.sessionId, user: toApiUser(session.user) })
  } catch (err) {
    sendError(res, err)
  }
})

// ── Contact verification: email ─────────────────────────────────────────────
router.post('/verify/email/start', async (req: Request, res: Response) => {
  try {
    await getIdentityProvider().startEmailVerification(bearer(req), req.body?.email)
    res.status(202).end()
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/verify/email/confirm', async (req: Request, res: Response) => {
  try {
    const status = await getIdentityProvider().confirmEmailVerification({
      token: req.body?.token,
      code: req.body?.code,
    })
    res.status(200).json(status)
  } catch (err) {
    sendError(res, err)
  }
})

// ── Contact verification: phone ─────────────────────────────────────────────
router.post('/verify/phone/start', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    if (!req.body?.phone) throw new InvalidInputError('phone is required')
    await getIdentityProvider().startPhoneVerification(token, req.body.phone)
    res.status(202).end()
  } catch (err) {
    sendError(res, err)
  }
})

router.post('/verify/phone/confirm', async (req: Request, res: Response) => {
  try {
    if (!req.body?.phone || !req.body?.code) throw new InvalidInputError('phone and code are required')
    const status = await getIdentityProvider().confirmPhoneVerification(req.body.phone, req.body.code)
    res.status(200).json(status)
  } catch (err) {
    sendError(res, err)
  }
})

router.get('/verify/status', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    const status = await getIdentityProvider().getVerificationStatus(token)
    res.status(200).json(status)
  } catch (err) {
    sendError(res, err)
  }
})

export default router
