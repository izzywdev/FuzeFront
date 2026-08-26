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
import crypto from 'crypto'
import express, { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { getIdentityProvider } from '../providers/factory'
import {
  MfaRequiredError,
  ConflictError,
  InvalidInputError,
  UnauthorizedError,
  NotFoundError,
  emailVerificationEnabled,
} from '../providers/authentik/AuthentikIdentityProvider'
import { appBaseUrl } from '../providers/authentik/config'
import { findUserPk, setUserPassword, PasswordPolicyError } from '../providers/authentik/accountApi'
import type {
  BrokeredSession,
  BrokeredUser,
  SessionContext,
} from '../providers/IdentityProvider'
import { authenticateToken } from '../middleware/auth'
import { db } from '../config/database'
import { resolveEmployeeStatus } from '../services/employeeRole'
import { isEmployeeConsoleEnabled } from '../utils/employeeFlag'
import { ROOT_ORG_ID } from '../migrations/014_seed_root_platform_organization'

const router = express.Router()

// ── Public email-availability rate limiter ───────────────────────────────────
//
// `/email-available` intentionally reveals whether an email is already
// registered — product wants inline "available / already registered" feedback
// on the signup form, which is impossible without disclosing existence. That
// makes the endpoint an enumeration oracle by design, so per-IP rate limiting
// is the deliberate mitigation: it keeps the interactive signup use fluid while
// making bulk address harvesting impractical. 20 requests / minute / IP.
// `req.ip` honours the service's `trust proxy` setting (see index.ts) so the
// key is the real client behind the ingress, not the ingress hop.
const emailAvailableRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later', code: 'RATE_LIMITED' },
})

// RFC-5322-lite: one @, no whitespace, a dotted domain. Deliberately simple —
// the goal is to reject obvious garbage (400), not to fully validate deliver-
// ability (that is the verification flow's job).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Helpers ─────────────────────────────────────────────────────────────────
function bearer(req: Request): string | null {
  const h = req.headers['authorization']
  if (!h || Array.isArray(h)) return null
  const [scheme, token] = h.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

/**
 * Capture the device/IP a session is being minted from, for manage-devices.
 *
 * Display-only — never an authorization input, so a spoofed user-agent or
 * X-Forwarded-For can mislabel a row in the user's own device list but cannot
 * grant access. `req.ip` honours Express's `trust proxy` setting, which is the
 * right place to decide how far down the proxy chain to believe.
 */
function sessionContext(req: Request): SessionContext {
  const ua = req.headers['user-agent']
  return {
    ip: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua : null,
  }
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
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message, code: 'NOT_FOUND' })
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
    // 503, NOT 401. The identity provider being unreachable/too slow is a
    // SERVICE condition, not a statement about the caller's credentials.
    // Returning 401 told every client "those credentials failed" for what is
    // actually an outage: the login UI has no way to tell a real rejection
    // from a provider stall, so a platform incident renders to users as "your
    // password is wrong" — they change a password that was never the problem,
    // and the outage stays invisible in auth-failure metrics.
    //
    // This aligns three things that had drifted apart: the contract's own
    // status map already declares PROVIDER_UNAVAILABLE -> 503
    // (tests/security-api/referenceApp.ts), and the legacy /api/auth/* route
    // already returns 503 for both of these errors (routes/auth.ts). This
    // route — the one the login form actually calls — was the sole outlier.
    //
    // Retry-After marks it explicitly retryable; both errors are transient
    // from the caller's point of view (an unavailable provider recovers, and
    // an undriveable flow stage is retryable via the SSO button).
    //
    // THE RESPONSE DELIBERATELY DOES NOT SAY WHICH OF THE TWO IT IS, so the
    // SERVER LOG MUST. `PROVIDER_UNAVAILABLE` covers two conditions that call
    // for opposite responses from whoever is paged:
    //
    //   AuthentikUnavailableError  the identity provider is unreachable or too
    //                              slow -> a platform incident, everyone is
    //                              affected, go look at the provider.
    //   UnsupportedFlowStageError  THIS account's login flow presented a stage
    //                              a server cannot drive (MFA, consent, a
    //                              prompt) -> nothing is down, browser/SSO
    //                              sign-in still works, and only callers using
    //                              the programmatic password grant are
    //                              affected. `err.message` carries the
    //                              offending stage component.
    //
    // Until 2026-08-26 this branch logged NOTHING and both rendered as one
    // opaque 503. That cost real time: a monitoring account whose flow gained
    // an undriveable stage was escalated as "production authentication is
    // down" while browser sign-in was working the whole time. The stage name
    // was in the thrown error and was being discarded one line from here.
    //
    // The BODY stays generic on purpose and is not what changed. The provider's
    // raw message can name internal hosts and flow slugs, and this endpoint is
    // unauthenticated -- `security-routes.test.ts` pins that the message is
    // never echoed. Diagnosis belongs in the log, which is already trusted with
    // it; the sibling legacy route (routes/auth.ts) has logged exactly this
    // split since it was written, so this brings the two into line rather than
    // inventing a scheme.
    //
    // Newlines are stripped before logging: `err.message` is provider-derived
    // and must not be able to forge extra log lines.
    const detail = String((err as Error)?.message ?? '').replace(/[\r\n]+/g, ' ')
    if (name === 'UnsupportedFlowStageError') {
      console.warn(
        '[security] createSession 503 PROVIDER_UNAVAILABLE: undriveable Authentik flow stage ' +
          '(NOT an outage -- browser/SSO sign-in is unaffected; this account needs it). ' +
          JSON.stringify({ stage: detail })
      )
    } else {
      console.error(
        '[security] createSession 503 PROVIDER_UNAVAILABLE: Authentik unreachable or too slow ' +
          '(platform incident -- all password sign-ins affected). ' +
          JSON.stringify({ detail })
      )
    }

    res.setHeader('Retry-After', '5')
    res.status(503).json({ error: 'Authentication unavailable', code: 'PROVIDER_UNAVAILABLE' })
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
    const session = await getIdentityProvider().passwordLogin(
      {
        email: req.body?.email,
        password: req.body?.password,
      },
      sessionContext(req)
    )
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

// ── Self-service password reset ────────────────────────────────────────────
// POST /v1/security/session/password/reset-request — ALWAYS 202
router.post('/session/password/reset-request', async (req: Request, res: Response) => {
  try {
    if (!req.body?.email || typeof req.body.email !== 'string') {
      // Only a MALFORMED body earns a 400; a well-formed unknown address does
      // not — that distinction is the whole no-enumeration guarantee.
      res.status(400).json({ error: 'email is required', code: 'MALFORMED' })
      return
    }
    await getIdentityProvider().requestPasswordReset(req.body.email)
  } catch (err) {
    // Never surface a provider failure here: a 5xx for real accounts and a 202
    // for unknown ones would be an enumeration oracle. Log and answer 202.
    console.error('[security] password reset request failed:', err)
  }
  res.status(202).end()
})

// POST /v1/security/session/password/reset-confirm
router.post('/session/password/reset-confirm', async (req: Request, res: Response) => {
  try {
    if (!req.body?.token || typeof req.body.token !== 'string') {
      throw new InvalidInputError('token is required')
    }
    if (!req.body?.newPassword || typeof req.body.newPassword !== 'string') {
      throw new InvalidInputError('newPassword is required')
    }
    await getIdentityProvider().confirmPasswordReset(req.body.token, req.body.newPassword)
    res.status(200).json({ reset: true })
  } catch (err) {
    // Per contract this surface is 400-or-200: an invalid/expired/consumed token
    // and a policy-rejected password are all fail-closed 400s.
    const name = (err as Error)?.name
    if (name === 'PasswordPolicyError') {
      res.status(400).json({ error: (err as Error).message, code: 'MALFORMED' })
      return
    }
    if (err instanceof InvalidInputError) {
      res.status(400).json({ error: err.message, code: 'MALFORMED' })
      return
    }
    console.error('[security] password reset confirm failed:', err)
    res.status(400).json({ error: 'Password reset failed', code: 'MALFORMED' })
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
    // Google echoes its issuer in the redirect (RFC 9207); the OIDC client
    // validates it, so it must survive the trip through the broker input.
    const iss = typeof req.query.iss === 'string' ? req.query.iss : undefined
    if (!code || !state) throw new InvalidInputError('code and state are required')
    const result = await getIdentityProvider().brokerCallback({ code, state, iss }, sessionContext(req))
    // Clear the state cookie; append the FuzeFront opaque code (never a token).
    res.setHeader('Set-Cookie', ['sec_social_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/'])
    const sep = result.redirectTo.includes('?') ? '&' : '?'
    // A LINK handshake mints no session, so there is no code to redeem — send
    // the browser back with a neutral confirmation instead.
    const dest = result.linked
      ? `${appBaseUrl()}${result.redirectTo}${sep}linked=${encodeURIComponent(result.provider ?? '')}`
      : `${appBaseUrl()}${result.redirectTo}${sep}code=${encodeURIComponent(result.code)}`
    res.redirect(302, dest)
  } catch (err) {
    // Fail-closed: send the browser back to the app with a neutral error.
    res.setHeader('Set-Cookie', ['sec_social_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/'])
    res.redirect(302, `${appBaseUrl()}/?error=authentication_failed`)
  }
})

// GET /v1/security/social/google/callback — SERVER-BROKERED Google callback.
//
// Google redirects the browser HERE (not to Authentik's
// `/source/oauth/callback/google/`) after consent. The security service exchanges
// the code with Google server-to-server, provisions/links the user in the
// identity store, mints the FuzeFront session, and 302s back to the app with a
// single-use opaque `?code=` (never a token, never an Authentik `/if/*` URL).
// State + PKCE are held server-side in the provider's Map (single replica) — no
// cookie round-trip needed for this path.
router.get('/social/google/callback', async (req: Request, res: Response) => {
  // Google can return an explicit error (e.g. the user denied consent). Never
  // leak provider detail to the app — send a neutral error back.
  if (typeof req.query.error === 'string' && req.query.error) {
    res.redirect(302, `${appBaseUrl()}/?error=authentication_failed`)
    return
  }
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    // Google echoes its issuer in the redirect (RFC 9207); the OIDC client
    // validates it, so it must survive the trip through the broker input.
    const iss = typeof req.query.iss === 'string' ? req.query.iss : undefined
    if (!code || !state) throw new InvalidInputError('code and state are required')
    const result = await getIdentityProvider().brokerCallback({ code, state, iss }, sessionContext(req))
    const sep = result.redirectTo.includes('?') ? '&' : '?'
    // A LINK handshake mints no session (no code to redeem) — return a neutral
    // confirmation instead.
    const dest = result.linked
      ? `${appBaseUrl()}${result.redirectTo}${sep}linked=${encodeURIComponent(result.provider ?? '')}`
      : `${appBaseUrl()}${result.redirectTo}${sep}code=${encodeURIComponent(result.code)}`
    res.redirect(302, dest)
  } catch (err) {
    // Fail-closed: neutral error back to the app. Never surface tokens or vendor.
    res.redirect(302, `${appBaseUrl()}/?error=authentication_failed`)
  }
})

// ── Signup ──────────────────────────────────────────────────────────────────
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const session = await getIdentityProvider().signup(
      {
        email: req.body?.email,
        password: req.body?.password,
        firstName: req.body?.firstName,
        lastName: req.body?.lastName,
        tenantName: req.body?.tenantName,
      },
      sessionContext(req)
    )
    res.status(201).json({ token: session.token, sessionId: session.sessionId, user: toApiUser(session.user) })
  } catch (err) {
    sendError(res, err)
  }
})

// ── Public email availability ─────────────────────────────────────────────
// GET /v1/security/email-available?email=<addr>
//
// Real-time signup feedback: is this email free to register? Checks the SAME
// source of truth signup consults (`emailExists`), so the answer can never
// disagree with what signup itself would do. Normalizes (trim + lowercase)
// before checking and echoes the normalized address back. Rate-limited above —
// the enumeration exposure is an accepted product tradeoff, not an oversight.
router.get('/email-available', emailAvailableRateLimiter, async (req: Request, res: Response) => {
  const raw = typeof req.query.email === 'string' ? req.query.email : ''
  const email = raw.trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'A valid email is required', code: 'MALFORMED' })
    return
  }
  try {
    const exists = await getIdentityProvider().emailExists(email)
    res.status(200).json({ available: !exists, email })
  } catch (err) {
    sendError(res, err)
  }
})

// ── Capabilities ──────────────────────────────────────────────────────────
/**
 * The SMS transport is a two-condition gate like email's: an SMS path only
 * exists when the family sms-service is reachable by Service DNS. Without
 * `SMS_SERVICE_URL` the dispatcher has nowhere to send, so any SMS factor or
 * phone-verification challenge would be minted but never delivered.
 * Provider-neutral: no vendor is named.
 */
function smsTransportConfigured(): boolean {
  return !!(process.env.SMS_SERVICE_URL && process.env.SMS_SERVICE_URL.trim())
}

/**
 * Neutral capability descriptor, DERIVED from actual configuration.
 *
 * This descriptor is a promise the UI renders affordances from: every `true`
 * here becomes a flow a user can start. Over-reporting is therefore worse than
 * under-reporting — an unconfigured transport advertised as available dead-ends
 * the user mid-way through securing their account. So each field reports only
 * what can actually complete end-to-end, and anything unconfigured is reported
 * as absent rather than assumed.
 */
router.get('/methods', (_req: Request, res: Response) => {
  const social: Array<'google'> = process.env.SECURITY_SOCIAL_GOOGLE === 'false' ? [] : ['google']

  const emailAvailable = emailVerificationEnabled()
  const smsAvailable = smsTransportConfigured()

  // `totp` is self-contained (shared secret + local clock), so it is always
  // available; `sms`/`email` require their transport to be configured.
  const mfaTypes: Array<'totp' | 'sms' | 'email'> = ['totp']
  if (smsAvailable) mfaTypes.push('sms')
  if (emailAvailable) mfaTypes.push('email')

  res.status(200).json({
    password: true,
    social,
    mfa: { enabled: mfaTypes.length > 0, types: mfaTypes },
    verification: { email: emailAvailable, sms: smsAvailable },
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
    const session = await getIdentityProvider().verifyMfa(
      req.body.challengeId,
      req.body.factorId,
      req.body.code,
      sessionContext(req)
    )
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
    if (!req.body?.token && !req.body?.code) {
      throw new InvalidInputError('token or code is required')
    }
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

// ── Manage devices (platform sessions) ────────────────────────────────────
//
// Note these are `/sessions` (plural) — the device-management collection —
// distinct from the `/session` (singular) sign-in lifecycle above.

// GET /v1/security/sessions — the caller's active sessions, current flagged
router.get('/sessions', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    const items = await getIdentityProvider().listSessions(token)
    res.status(200).json({ items })
  } catch (err) {
    sendError(res, err)
  }
})

// DELETE /v1/security/sessions — revoke all OTHER sessions, keep the caller's
router.delete('/sessions', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    await getIdentityProvider().revokeOtherSessions(token)
    res.status(204).end()
  } catch (err) {
    sendError(res, err)
  }
})

// DELETE /v1/security/sessions/{id} — revoke one session (idempotent)
router.delete('/sessions/:id', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    await getIdentityProvider().revokeSession(token, req.params.id)
    res.status(204).end()
  } catch (err) {
    sendError(res, err)
  }
})

// ── Account sign-in connections ───────────────────────────────────────────
// GET /v1/security/identity/connections — linked providers + password state
router.get('/identity/connections', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    const conns = await getIdentityProvider().getIdentityConnections(token)
    res.status(200).json(conns)
  } catch (err) {
    sendError(res, err)
  }
})

// POST /v1/security/social/{provider}/link — begin linking for a signed-in user
router.post('/social/:provider/link', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    const { redirectUrl, state, codeVerifier } = await getIdentityProvider().startSocialLink(
      token,
      req.params.provider
    )
    // Same cookie contract as sign-in: the registered OIDC redirect_uri handler
    // is replica-agnostic and reads state/PKCE from these HttpOnly cookies.
    res.setHeader('Set-Cookie', [
      `oidc_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
      `oidc_cv=${codeVerifier}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
      `sec_social_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    ])
    // 200 + { redirectUrl } (not a 302): the caller is the SPA via fetch with a
    // bearer token, and a redirect chased by fetch would never reach the browser.
    res.status(200).json({ redirectUrl })
  } catch (err) {
    sendError(res, err)
  }
})

// DELETE /v1/security/social/{provider}/link — unlink (409 if last method)
router.delete('/social/:provider/link', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    const conns = await getIdentityProvider().unlinkSocial(token, req.params.provider)
    res.status(200).json(conns)
  } catch (err) {
    sendError(res, err)
  }
})

// ── Set password (social-only accounts) ───────────────────────────────────
// POST /v1/security/password — add a password; 409 if one already exists
router.post('/password', async (req: Request, res: Response) => {
  const token = requireBearer(req, res)
  if (!token) return
  try {
    if (!req.body?.newPassword) throw new InvalidInputError('newPassword is required')
    const conns = await getIdentityProvider().setPassword(token, req.body.newPassword)
    res.status(200).json(conns)
  } catch (err) {
    sendError(res, err)
  }
})

// ── Admin / internal-only ─────────────────────────────────────────────────
//
// These routes are on the public-ingress surface (/api/v1/security/*) but are
// protected by the INTERNAL_PROVISION_SECRET shared secret (x-internal-secret
// header, constant-time comparison). They are intended for service-to-service
// calls and CI/smoke tooling — never for the browser SPA.

function isInternalAuthorized(req: Request): boolean {
  const expected = process.env.INTERNAL_PROVISION_SECRET
  const provided = req.header('x-internal-secret')
  const a = Buffer.from(provided || '')
  const b = Buffer.from(expected || '')
  return !(
    !expected ||
    !provided ||
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  )
}

/**
 * POST /api/v1/security/admin/reset-password
 *
 * Forcibly resets a user's password in the identity store for the tenant
 * resolved from the request Host. Used by the post-prod smoke test to
 * self-heal credential drift without bypassing tenant routing.
 *
 * Protected by x-internal-secret: INTERNAL_PROVISION_SECRET. Tenant context
 * is set automatically by the tenantContext middleware already applied to
 * /api/v1/security, so findUserPk + setUserPassword target the right Authentik
 * instance even in multi-portal deployments.
 *
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "email": "...", "newPassword": "..." }
 *   200 { ok: true }
 *   400 { error } missing/bad body, or password rejected by policy
 *   401 { error } bad/missing secret
 *   404 { error } user not found in the identity store
 */
router.post('/admin/reset-password', async (req: Request, res: Response) => {
  if (!isInternalAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { email, newPassword } = req.body || {}
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' })
  }
  if (!newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'newPassword is required' })
  }

  try {
    const pk = await findUserPk(email)
    await setUserPassword(pk, newPassword)
    return res.status(200).json({ ok: true })
  } catch (err: any) {
    if (err instanceof PasswordPolicyError) {
      return res.status(400).json({ error: err.message, code: 'PASSWORD_POLICY' })
    }
    if (err?.message === 'identity store user not found') {
      return res.status(404).json({ error: `No user found for email: ${email}` })
    }
    console.error('[security] admin/reset-password failed:', err)
    return res.status(500).json({ error: 'Password reset failed', detail: String(err?.message ?? err) })
  }
})

// ── Employee (platform-staff) surfaces (FF-EPIC-17-S9) ─────────────────────
//
// Frozen contract: `packages/security/openapi.yaml` `getEmployeeStatus` /
// `listEmployeeOrgs` (PR #698). Both are backed by the S8 domain logic
// (`resolveEmployeeStatus`, PR #655) — `isEmployee` is derived ONLY from the
// ReBAC `org-admin` grant on the platform root org, NEVER from membership
// rows. Behind `fuzefront.identity.employee-console` (default OFF — mirrors
// the `/directory` route's convention: OFF renders 404 exactly as if the
// route did not exist, no DB access at all).
//
// Auth here is the session-JWT `authenticateToken` middleware (req.user),
// the SAME pattern `routes/organizations.ts`'s directory route uses — not
// this file's `requireBearer` + provider round-trip, because
// `resolveEmployeeStatus` needs a resolved `req.user.id`, and the session
// tokens minted by `AuthentikIdentityProvider` are signed with the same
// `JWT_SECRET` `authenticateToken` verifies.

const EMPLOYEE_ORGS_DEFAULT_LIMIT = 50
const EMPLOYEE_ORGS_MAX_LIMIT = 200

function parseEmployeeOrgsLimit(raw: any): number {
  const n = parseInt(String(raw), 10)
  if (!Number.isFinite(n) || n < 1) return EMPLOYEE_ORGS_DEFAULT_LIMIT
  return Math.min(n, EMPLOYEE_ORGS_MAX_LIMIT)
}

// Opaque cursor over the deterministic (depth ASC, id ASC) walk of the org
// subtree — the sort key (depth) plus a tiebreaker (id), per the family
// pagination standard. Mirrors `encodeMemberCursor`/`decodeMemberCursor`
// (`backend/src/routes/organizations.ts`).
function encodeEmployeeOrgCursor(row: { depth: number; id: string }): string {
  return Buffer.from(`${row.depth}|${row.id}`, 'utf8').toString('base64url')
}

function decodeEmployeeOrgCursor(cursor: string): { depth: number; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const idx = decoded.indexOf('|')
    if (idx < 0) return null
    const depth = parseInt(decoded.slice(0, idx), 10)
    const id = decoded.slice(idx + 1)
    if (!Number.isFinite(depth) || depth < 0 || !id) return null
    return { depth, id }
  } catch {
    return null
  }
}

/** Node classification for the explorer — never an authorization input. */
function classifyOrgKind(orgId: string, parentOrgId: string | null): 'root' | 'portal' | 'organization' {
  if (orgId === ROOT_ORG_ID) return 'root'
  if (parentOrgId === ROOT_ORG_ID) return 'portal'
  return 'organization'
}

// GET /v1/security/employee/status — server-authoritative Employee status
// for the calling user. Any authenticated caller may read their OWN status;
// a non-Employee simply gets `isEmployee: false` (this REPORTS status, it
// does not gate on it — deliberately no 403 here, per contract).
router.get('/employee/status', authenticateToken, async (req: any, res: Response) => {
  try {
    const enabled = await isEmployeeConsoleEnabled({ userId: req.user.id })
    if (!enabled) {
      res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' })
      return
    }

    const status = await resolveEmployeeStatus(req.user.id)

    // `resolveEmployeeStatus.directOrgMemberships` is id-only (S8's frozen
    // shape). Enrich with org name + role for the informational
    // `DirectMembershipRef[]` this contract requires — skipped entirely for a
    // pure Employee (empty array), so zero extra DB round-trip in that case.
    let directOrgMemberships: Array<{ orgId: string; orgName: string; role: string }> = []
    if (status.directOrgMemberships.length > 0) {
      const rows = await db('organization_memberships as om')
        .join('organizations as o', 'o.id', 'om.organization_id')
        .where('om.user_id', req.user.id)
        .whereIn('om.organization_id', status.directOrgMemberships)
        .select('om.organization_id as org_id', 'om.role', 'o.name as org_name')
      directOrgMemberships = rows.map((row: any) => ({
        orgId: row.org_id,
        orgName: row.org_name,
        role: row.role,
      }))
    }

    res.status(200).json({ isEmployee: status.isEmployee, directOrgMemberships })
  } catch (error) {
    console.error('[security] Error resolving employee status:', error)
    res.status(500).json({ error: 'Failed to resolve employee status' })
  }
})

// GET /v1/security/employee/orgs — Employee-only. Cursor-paginated FLAT list
// of the platform root + its descendants (the ReBAC-authoritative reach),
// NOT the caller's membership-scoped orgs. A non-Employee caller gets 403
// FORBIDDEN — an id is never a capability; authorization is the token +
// Permit (`resolveEmployeeStatus`'s ReBAC check), not knowledge of any org id.
router.get('/employee/orgs', authenticateToken, async (req: any, res: Response) => {
  try {
    const enabled = await isEmployeeConsoleEnabled({ userId: req.user.id })
    if (!enabled) {
      res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' })
      return
    }

    const status = await resolveEmployeeStatus(req.user.id)
    if (!status.isEmployee) {
      res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' })
      return
    }

    const limit = parseEmployeeOrgsLimit(req.query.limit)
    const rawCursor = req.query.cursor ? String(req.query.cursor) : undefined
    let cursorValue: { depth: number; id: string } | null = null
    if (rawCursor) {
      cursorValue = decodeEmployeeOrgCursor(rawCursor)
      if (!cursorValue) {
        res.status(400).json({ error: 'Invalid cursor', code: 'MALFORMED' })
        return
      }
    }

    // Recursive walk of the org tree rooted at ROOT_ORG_ID (parent_id chain).
    // Deterministic order (depth ASC, id ASC) so the keyset cursor — a row-
    // value comparison on the SAME (depth, id) tuple — pages the full subtree
    // with no gaps/dupes under concurrent writes, and a page boundary never
    // splits a subtree (BFS by depth). `member_count` is a per-row correlated
    // count, bounded to the page (limit+1 rows), so it stays cheap.
    const bindings: any[] = [ROOT_ORG_ID]
    let cursorClause = ''
    if (cursorValue) {
      cursorClause = 'WHERE (ot.depth, ot.id) > (?, ?)'
      bindings.push(cursorValue.depth, cursorValue.id)
    }
    bindings.push(limit + 1)

    const result = await db.raw(
      `WITH RECURSIVE org_tree AS (
         SELECT id, name, parent_id, 0 AS depth
         FROM organizations
         WHERE id = ? AND is_active = true
         UNION ALL
         SELECT o.id, o.name, o.parent_id, ot.depth + 1
         FROM organizations o
         JOIN org_tree ot ON o.parent_id = ot.id
         WHERE o.is_active = true
       )
       SELECT ot.id, ot.name, ot.parent_id, ot.depth,
         (SELECT COUNT(*)::int FROM organization_memberships om
            WHERE om.organization_id = ot.id AND om.status = 'active') AS member_count
       FROM org_tree ot
       ${cursorClause}
       ORDER BY ot.depth ASC, ot.id ASC
       LIMIT ?`,
      bindings
    )

    const rows: any[] = result?.rows ?? []
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? encodeEmployeeOrgCursor(page[page.length - 1]) : null

    const items = page.map((row: any) => ({
      orgId: row.id,
      name: row.name,
      parentOrgId: row.parent_id ?? null,
      kind: classifyOrgKind(row.id, row.parent_id ?? null),
      depth: row.depth,
      ...(row.member_count != null ? { memberCount: Number(row.member_count) } : {}),
    }))

    res.status(200).json({ items, page: { nextCursor, hasMore } })
  } catch (error) {
    console.error('[security] Error listing employee orgs:', error)
    res.status(500).json({ error: 'Failed to list employee orgs' })
  }
})

export default router
