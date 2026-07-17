/**
 * AuthentikIdentityProvider — the FIRST concrete `IdentityProvider`.
 *
 * This is the ONLY place the identity vendor (Authentik) and the delivery
 * vendors (SMS/email via the family services) are named. Everything above it —
 * the `/api/v1/security` routes, consumers, the SPA — speaks only the neutral
 * `IdentityProvider` contract. Swap this class to swap providers.
 *
 * It ABSORBS the pre-existing server-brokered machinery:
 *   - services/oidc.ts            (OIDC code+PKCE, HS256 id_token override, user sync)
 *   - services/authentikPassword.ts (server-side flow-executor password login)
 *   - backend/src/services/machine-identity.ts (M2M client provisioning + introspection)
 *
 * Fail-closed everywhere: any provider/transport error rejects; a caller never
 * receives a permissive fallback identity or session.
 *
 * All dependencies are injectable so the unit tests exercise the logic without
 * real network / DB where possible.
 */
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db as defaultDb } from '../../config/database'
import { oidcService as defaultOidc } from '../../services/oidc'
import { authentikPasswordLogin as defaultPasswordLogin } from '../../services/authentikPassword'
import { runInternalProvision } from '../../services/organizationProvisioning'
import { authentikSignup as defaultSignup, EnrollmentConflictError } from '../../services/authentikPassword'
import { putBrokerCode, takeBrokerCode } from '../../services/brokerCodes'
import type {
  IdentityProvider,
  BrokeredSession,
  BrokeredUser,
  NormalizedIdentity,
  PasswordLoginInput,
  SignupInput,
  SocialLoginStart,
  SocialCallbackInput,
  SocialCallbackResult,
  M2MClient,
  M2MClientProvisionInput,
  M2MToken,
  M2MTokenInput,
  TokenIntrospection,
  MfaFactor,
  MfaFactorType,
  MfaEnrollInput,
  MfaEnrollResult,
  MfaChallengeAck,
  VerificationStatus,
} from '../IdentityProvider'
import {
  HttpNotificationClient,
  type NotificationClient,
} from './notifications'
import * as totp from './totp'
import {
  idpProxyPrefix,
  jwtSecret,
  SESSION_TTL_MS,
  CODE_TTL_MS,
} from './config'

/** Thrown when credentials are valid but the account requires MFA step-up. */
export class MfaRequiredError extends Error {
  constructor(
    public challengeId: string,
    public factors: { factorId: string; type: MfaFactorType }[]
  ) {
    super('mfa_required')
    this.name = 'MfaRequiredError'
  }
}

/** Thrown when an email already has an account (signup conflict). */
export class ConflictError extends Error {
  constructor(message = 'An account with that email already exists') {
    super(message)
    this.name = 'ConflictError'
  }
}

/** Thrown when a request is structurally invalid (maps to 400). */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidInputError'
  }
}

/** Thrown on unknown/expired opaque codes, bad tokens, bad OTP (maps to 401). */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

type Db = typeof defaultDb

interface SocialState {
  codeVerifier: string
  redirectTo: string
  expiresAt: number
}
interface MfaChallenge {
  userId: string
  expiresAt: number
}

const CHALLENGE_TTL_MS = 5 * 60_000
const EMAIL_VERIFY_TTL_MS = 30 * 60_000

/**
 * Registration-time email verification is a two-condition gate, kept a release
 * flag (default OFF) until prod SMTP is wired:
 *
 *   - `REQUIRE_EMAIL_VERIFICATION` (default `false`) is the release/kill switch.
 *   - `EMAIL_SERVICE_URL` must be configured (the family email-service reachable
 *     by Service DNS) for a real message to be deliverable.
 *
 * When BOTH hold, verification is REQUIRED: we mint a link token + OTP and
 * dispatch it. Otherwise we GRACEFULLY DEGRADE — auto-verify the address and log
 * — so signup/local dev/prod-without-SMTP never strands a user on an
 * undeliverable challenge. Provider-neutral: no vendor is named.
 */
export function emailVerificationEnabled(): boolean {
  return (
    process.env.REQUIRE_EMAIL_VERIFICATION === 'true' &&
    !!(process.env.EMAIL_SERVICE_URL && process.env.EMAIL_SERVICE_URL.trim())
  )
}

export interface AuthentikProviderDeps {
  db: Db
  oidc: typeof defaultOidc
  passwordLoginFn: (email: string, password: string) => Promise<BrokeredUser>
  /** Drives Authentik enrollment + OIDC sync; returns the synced user projection. */
  signupFn: (input: SignupInput) => Promise<BrokeredUser>
  notifications: NotificationClient
  now: () => number
  /** Injected M2M provisioning (defaults to the absorbed machine-identity module). */
  provisionM2M?: (name: string, scopes: string[]) => Promise<M2MClient>
  issueM2M?: (input: M2MTokenInput) => Promise<M2MToken>
  introspectM2M?: (token: string) => Promise<TokenIntrospection>
}

function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex')
}

function maskContact(v: string): string {
  if (v.includes('@')) {
    const [u, d] = v.split('@')
    return `${u.slice(0, 1)}***@${d}`
  }
  return `***${v.slice(-4)}`
}

export class AuthentikIdentityProvider implements IdentityProvider {
  private db: Db
  private oidc: typeof defaultOidc
  private passwordLoginFn: (email: string, password: string) => Promise<BrokeredUser>
  private signupFn: (input: SignupInput) => Promise<BrokeredUser>
  private notifications: NotificationClient
  private now: () => number
  private provisionM2MFn?: (name: string, scopes: string[]) => Promise<M2MClient>
  private issueM2MFn?: (input: M2MTokenInput) => Promise<M2MToken>
  private introspectM2MFn?: (token: string) => Promise<TokenIntrospection>

  private socialStates = new Map<string, SocialState>()
  private mfaChallenges = new Map<string, MfaChallenge>()

  constructor(deps: Partial<AuthentikProviderDeps> = {}) {
    this.db = deps.db ?? defaultDb
    this.oidc = deps.oidc ?? defaultOidc
    this.passwordLoginFn =
      deps.passwordLoginFn ??
      (async (email, password) => {
        const user = await defaultPasswordLogin(email, password)
        return { ...user, roles: user.roles ?? [] } as BrokeredUser
      })
    this.signupFn =
      deps.signupFn ??
      (async (input) => {
        const user = await defaultSignup({
          email: input.email,
          password: input.password,
          firstName: input.firstName,
          lastName: input.lastName,
        })
        return { ...user, roles: user.roles ?? [] } as BrokeredUser
      })
    this.notifications = deps.notifications ?? new HttpNotificationClient()
    this.now = deps.now ?? (() => Date.now())
    this.provisionM2MFn = deps.provisionM2M
    this.issueM2MFn = deps.issueM2M
    this.introspectM2MFn = deps.introspectM2M
  }

  // ── Session minting ───────────────────────────────────────────────────────
  private async mintSession(user: BrokeredUser): Promise<BrokeredSession> {
    const sessionId = uuidv4()
    const expiresAt = new Date(this.now() + SESSION_TTL_MS)
    const token = jwt.sign({ userId: user.id, sessionId }, jwtSecret(), {
      expiresIn: '24h',
    })
    await this.db('sessions').insert({
      id: sessionId,
      user_id: user.id,
      expires_at: expiresAt,
    })
    // Self-heal provisioning in the background — never blocks/fails the response.
    runInternalProvision(user.id).catch(err =>
      console.error(`Login self-heal provisioning failed for ${user.id}:`, err)
    )
    return { token, sessionId, user }
  }

  private async loadActiveFactors(userId: string): Promise<MfaFactor[]> {
    const rows = await this.db('mfa_factors')
      .where({ user_id: userId, status: 'active' })
      .select('*')
    return rows.map(rowToFactor)
  }

  /** Gate a freshly-authenticated user through MFA step-up when factors exist. */
  private async sessionOrChallenge(user: BrokeredUser): Promise<BrokeredSession> {
    const factors = await this.loadActiveFactors(user.id)
    if (factors.length > 0) {
      const challengeId = crypto.randomBytes(24).toString('hex')
      this.mfaChallenges.set(challengeId, {
        userId: user.id,
        expiresAt: this.now() + CHALLENGE_TTL_MS,
      })
      throw new MfaRequiredError(
        challengeId,
        factors.map(f => ({ factorId: f.factorId, type: f.type }))
      )
    }
    return this.mintSession(user)
  }

  // ── Password login ────────────────────────────────────────────────────────
  async passwordLogin(input: PasswordLoginInput): Promise<BrokeredSession> {
    if (!input?.email || !input?.password) {
      throw new InvalidInputError('email and password are required')
    }
    const user = await this.passwordLoginFn(input.email, input.password)
    return this.sessionOrChallenge(user)
  }

  // ── Social login (server-brokered; browser never sees an internal host) ────
  async startSocialLogin(provider: string, redirectTo = '/'): Promise<SocialLoginStart> {
    if (provider !== 'google') {
      throw new InvalidInputError(`unsupported social provider: ${provider}`)
    }
    // Reject non-same-origin return targets (open-redirect guard).
    if (/^https?:\/\//i.test(redirectTo) || redirectTo.startsWith('//')) {
      throw new InvalidInputError('redirectTo must be a same-origin path')
    }
    if (!this.oidc.isInitialized()) {
      await this.oidc.initialize()
    }
    const state = crypto.randomBytes(24).toString('hex')
    const { url, codeVerifier } = this.oidc.generateAuthUrl(state)

    // Rewrite the absolute internal authorize URL to a SAME-HOST path under the
    // IdP reverse-proxy prefix, so the browser never sees the internal host.
    const authorize = new URL(url)
    const authorizePath = `${idpProxyPrefix()}${authorize.pathname}${authorize.search}`

    // Launch the provider's SOURCE directly rather than sending the browser to
    // the generic authorize endpoint. Authorize requires an authenticated
    // session, so with none it falls back to the brand's authentication flow
    // and renders the IdP's identification page (`/if/flow/...`) with a social
    // button — stranding the user on the provider's own UI.
    //
    // The source-redirect view instead 302s straight to the social provider.
    // It returns to /source/oauth/callback/<provider>/, the source flow runs
    // (auto stages: silent enrollment first time, login when returning) and
    // establishes the session, then `next` sends the browser to authorize,
    // which now issues the code silently. Same cookie/state/PKCE round-trip —
    // this only inserts one hop ahead of authorize, so no `/if/flow/` renders.
    //
    // The source slug tracks `provider` (guarded to `google` above) so widening
    // that guard cannot silently route a new provider through Google's source.
    const redirectUrl =
      `${idpProxyPrefix()}/source/oauth/login/${provider}/` +
      `?next=${encodeURIComponent(authorizePath)}`

    this.socialStates.set(state, {
      codeVerifier,
      redirectTo,
      expiresAt: this.now() + 10 * 60_000,
    })
    // codeVerifier is handed back so the route can persist it in an HttpOnly
    // cookie (`oidc_cv`) for the replica-agnostic OIDC callback.
    return { redirectUrl, state, codeVerifier }
  }

  async brokerCallback(input: SocialCallbackInput): Promise<SocialCallbackResult> {
    const st = this.socialStates.get(input.state)
    if (!st || st.expiresAt < this.now()) {
      this.socialStates.delete(input.state)
      throw new UnauthorizedError('invalid or expired state')
    }
    this.socialStates.delete(input.state)

    const user = (await this.oidc.handleCallback(
      input.code,
      input.state,
      st.codeVerifier
    )) as BrokeredUser

    // Mint the session now and hand back a single-use opaque code (never a token
    // in the URL). Social sign-in does not re-gate MFA at the browser hop.
    const session = await this.mintSession(user)
    const code = crypto.randomBytes(32).toString('hex')
    // Shared store: a code minted here OR by the legacy /api/auth/oidc/callback
    // is redeemable by the SPA's /api/v1/security/session/exchange.
    putBrokerCode(code, {
      token: session.token,
      sessionId: session.sessionId,
      user: session.user,
      expiresAt: this.now() + CODE_TTL_MS,
    })
    return { code, redirectTo: st.redirectTo || '/' }
  }

  async exchangeCode(code: string): Promise<BrokeredSession> {
    const entry = takeBrokerCode(code, this.now())
    if (!entry) {
      throw new UnauthorizedError('invalid or expired code')
    }
    return { token: entry.token, sessionId: entry.sessionId, user: entry.user }
  }

  // ── Signup (server-brokered against Authentik enrollment) ─────────────────
  //
  // The account is created in AUTHENTIK (the sole identity authority) by driving
  // its self-service enrollment flow server-side; the flow's final user-login
  // stage auto-authenticates the new user, so the OIDC code exchange runs and
  // the local `users` row is created as a SYNCED PROJECTION via the SAME
  // syncUserToDatabase path login uses (which also writes the identity.user.created
  // outbox row + event). There is NO local bcrypt user — that split-brain (a
  // local user Authentik never knew about, thus unable to log in) is the bug this
  // replaces.
  async signup(input: SignupInput): Promise<BrokeredSession> {
    if (!input?.email || !input?.password) {
      throw new InvalidInputError('email and password are required')
    }
    // Fast-path conflict on the synced projection (cheap; the enrollment flow is
    // also authoritative and maps its own "already exists" to ConflictError).
    const existing = await this.db('users').where('email', input.email).first()
    if (existing) throw new ConflictError()

    let user: BrokeredUser
    try {
      user = await this.signupFn(input)
    } catch (err) {
      if (err instanceof EnrollmentConflictError) throw new ConflictError()
      throw err
    }
    // Kick off contact-ownership verification for the freshly-enrolled address.
    // Best-effort: a delivery/transport failure must NOT fail the signup — the
    // user can re-request via /verify/email/start. In degrade mode this simply
    // auto-verifies + logs. Uses the user id directly (no bearer needed yet).
    try {
      await this.startEmailVerificationForUser(user.id, user.email)
    } catch (err) {
      // Constant format string + args: the email is attacker-chosen, so
      // interpolating it INTO the format string lets a `%s` in an address forge
      // log output (console.* applies util.format specifiers to the first arg).
      console.error(
        '[security] signup email-verification dispatch failed for %s: %s',
        maskContact(user.email),
        (err as Error).message,
      )
    }

    // Gate through MFA step-up if the (rare, freshly-enrolled) account already
    // has active factors — otherwise mint the session directly.
    return this.sessionOrChallenge(user)
  }

  /**
   * Internal variant of startEmailVerification keyed by a known user id (used at
   * signup, before any bearer exists). Honours the same degrade gate.
   */
  private async startEmailVerificationForUser(userId: string, email: string): Promise<void> {
    if (!email) return
    if (!emailVerificationEnabled()) {
      await this.db('users').where({ id: userId }).update({ email_verified: true })
      console.warn(
        `[security] email verification degraded at signup (auto-verified ${maskContact(
          email,
        )}); set REQUIRE_EMAIL_VERIFICATION=true + EMAIL_SERVICE_URL to enforce.`,
      )
      return
    }
    const linkToken = crypto.randomBytes(32).toString('hex')
    const code = ('' + crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    await this.db('email_verifications').insert({
      id: uuidv4(),
      user_id: userId,
      email,
      token_hash: sha256(linkToken),
      code_hash: sha256(code),
      expires_at: new Date(this.now() + EMAIL_VERIFY_TTL_MS),
      consumed: false,
    })
    await this.notifications.sendEmailVerification(email, linkToken, code)
  }

  // ── Identity / session inspection ─────────────────────────────────────────
  private verifySessionToken(token: string): { userId: string; sessionId?: string; iat?: number; exp?: number } {
    try {
      return jwt.verify(token, jwtSecret()) as any
    } catch {
      throw new UnauthorizedError('invalid token')
    }
  }

  private async loadUser(userId: string): Promise<BrokeredUser> {
    const row = await this.db('users').where('id', userId).first()
    if (!row) throw new UnauthorizedError('user not found')
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      defaultAppId: row.default_app_id,
      roles: Array.isArray(row.roles) ? row.roles : JSON.parse(row.roles || '["user"]'),
    }
  }

  async getUserInfo(token: string): Promise<{ identity: NormalizedIdentity; user: BrokeredUser }> {
    const decoded = this.verifySessionToken(token)
    // Session must still exist (revocation is authoritative).
    if (decoded.sessionId) {
      const session = await this.db('sessions').where('id', decoded.sessionId).first()
      if (!session) throw new UnauthorizedError('session revoked')
      if (session.expires_at && new Date(session.expires_at).getTime() < this.now()) {
        throw new UnauthorizedError('session expired')
      }
    }
    const user = await this.loadUser(decoded.userId)
    const identity: NormalizedIdentity = {
      userId: user.id,
      tenantId: null,
      roles: user.roles,
      email: user.email,
      authMode: 'legacy-hs256',
      issuedAt: decoded.iat,
      expiresAt: decoded.exp,
    }
    return { identity, user }
  }

  async logout(token: string): Promise<void> {
    // Idempotent + fail-closed: a bad token simply revokes nothing.
    try {
      const decoded = this.verifySessionToken(token)
      if (decoded.sessionId) {
        await this.db('sessions').where('id', decoded.sessionId).del()
      }
    } catch {
      /* idempotent: nothing to revoke */
    }
  }

  // ── M2M ───────────────────────────────────────────────────────────────────
  async provisionM2MClient(input: M2MClientProvisionInput): Promise<M2MClient> {
    if (this.provisionM2MFn) return this.provisionM2MFn(input.name, input.scope ? input.scope.split(' ') : ['openid'])
    const { registerMachineClient } = await import('../../services/machine-identity')
    const res = await registerMachineClient(input.name, input.scope ? input.scope.split(' ') : ['openid'])
    return { clientId: res.clientId, clientSecret: res.clientSecret, scope: input.scope }
  }

  async issueM2MToken(input: M2MTokenInput): Promise<M2MToken> {
    if (this.issueM2MFn) return this.issueM2MFn(input)
    // client-credentials grant against the global token endpoint.
    const issuer = process.env.AUTHENTIK_ISSUER_URL || 'http://localhost:9000/application/o/fuzefront/'
    const tokenEndpoint = new URL('/application/o/token/', new URL(issuer).origin).toString()
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: input.clientId,
      client_secret: input.clientSecret,
    })
    if (input.scope) body.append('scope', input.scope)
    let res: Response
    try {
      res = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
    } catch (err) {
      throw new Error(`token endpoint unreachable: ${(err as Error).message}`)
    }
    if (!res.ok) throw new UnauthorizedError('invalid client credentials')
    const data = (await res.json()) as { access_token: string; expires_in: number; scope?: string }
    return {
      accessToken: data.access_token,
      tokenType: 'Bearer',
      expiresIn: data.expires_in,
      scope: data.scope,
    }
  }

  async introspectToken(token: string): Promise<TokenIntrospection> {
    // First try our own session token.
    try {
      const decoded = this.verifySessionToken(token)
      return { active: true, subject: decoded.userId, tenantId: null, expiresAt: decoded.exp }
    } catch {
      /* fall through to M2M introspection */
    }
    try {
      if (this.introspectM2MFn) return this.introspectM2MFn(token)
      const { introspectMachineToken } = await import('../../services/machine-identity')
      const r = await introspectMachineToken(token)
      if (!r.active) return { active: false }
      return { active: true, subject: r.sub || r.client_id, scope: r.scope, expiresAt: r.exp }
    } catch {
      return { active: false } // fail-closed
    }
  }

  // ── MFA factor management ─────────────────────────────────────────────────
  async listFactors(token: string): Promise<MfaFactor[]> {
    const { user } = await this.getUserInfo(token)
    const rows = await this.db('mfa_factors').where({ user_id: user.id }).select('*')
    return rows.map(rowToFactor)
  }

  async enrollFactor(token: string, input: MfaEnrollInput): Promise<MfaEnrollResult> {
    const { user } = await this.getUserInfo(token)
    const factorId = uuidv4()
    if (input.type === 'totp') {
      const secret = totp.generateSecret()
      const uri = totp.provisioningUri(secret, user.email)
      await this.db('mfa_factors').insert({
        id: factorId,
        user_id: user.id,
        type: 'totp',
        status: 'pending',
        secret,
        label: 'Authenticator app',
      })
      return { factorId, type: 'totp', status: 'pending', secret, provisioningUri: uri }
    }
    if (input.type === 'sms') {
      if (!input.phone) throw new InvalidInputError('phone is required for sms factor')
      await this.notifications.sendSmsOtp(input.phone)
      await this.db('mfa_factors').insert({
        id: factorId,
        user_id: user.id,
        type: 'sms',
        status: 'pending',
        target: input.phone,
        label: maskContact(input.phone),
      })
      return { factorId, type: 'sms', status: 'pending', codeSent: true }
    }
    if (input.type === 'email') {
      const target = input.email || user.email
      const code = ('' + crypto.randomInt(0, 1_000_000)).padStart(6, '0')
      await this.notifications.sendEmailVerification(target, '', code)
      await this.db('mfa_factors').insert({
        id: factorId,
        user_id: user.id,
        type: 'email',
        status: 'pending',
        target,
        secret: sha256(code), // reused column holds the pending OTP hash
        label: maskContact(target),
      })
      return { factorId, type: 'email', status: 'pending', codeSent: true }
    }
    throw new InvalidInputError(`unsupported factor type: ${input.type}`)
  }

  private async verifyFactorCode(factor: any, code: string): Promise<boolean> {
    if (factor.type === 'totp') return totp.verifyToken(factor.secret, code)
    if (factor.type === 'sms') return this.notifications.checkSmsOtp(factor.target, code)
    if (factor.type === 'email') return factor.secret === sha256(code)
    return false
  }

  async activateFactor(token: string, factorId: string, code: string): Promise<MfaFactor> {
    const { user } = await this.getUserInfo(token)
    const factor = await this.db('mfa_factors')
      .where({ id: factorId, user_id: user.id })
      .first()
    if (!factor) throw new UnauthorizedError('factor not found')
    const ok = await this.verifyFactorCode(factor, code)
    if (!ok) throw new UnauthorizedError('invalid code')
    await this.db('mfa_factors').where({ id: factorId }).update({ status: 'active', updated_at: new Date() })
    return rowToFactor({ ...factor, status: 'active' })
  }

  async removeFactor(token: string, factorId: string): Promise<void> {
    const { user } = await this.getUserInfo(token)
    await this.db('mfa_factors').where({ id: factorId, user_id: user.id }).del()
  }

  async regenerateRecoveryCodes(token: string): Promise<string[]> {
    const { user } = await this.getUserInfo(token)
    await this.db('mfa_recovery_codes').where({ user_id: user.id }).del()
    const codes: string[] = []
    for (let i = 0; i < 10; i++) {
      codes.push(crypto.randomBytes(5).toString('hex'))
    }
    await this.db('mfa_recovery_codes').insert(
      codes.map(c => ({ id: uuidv4(), user_id: user.id, code_hash: sha256(c), used: false }))
    )
    return codes
  }

  // ── MFA login step-up ─────────────────────────────────────────────────────
  async challengeMfa(challengeId: string, factorId: string): Promise<MfaChallengeAck> {
    const ch = this.mfaChallenges.get(challengeId)
    if (!ch || ch.expiresAt < this.now()) {
      this.mfaChallenges.delete(challengeId)
      throw new UnauthorizedError('invalid or expired challenge')
    }
    const factor = await this.db('mfa_factors')
      .where({ id: factorId, user_id: ch.userId, status: 'active' })
      .first()
    if (!factor) throw new UnauthorizedError('factor not found')

    if (factor.type === 'sms') {
      await this.notifications.sendSmsOtp(factor.target)
      return { challengeId, factorId, delivered: true }
    }
    if (factor.type === 'email') {
      const code = ('' + crypto.randomInt(0, 1_000_000)).padStart(6, '0')
      await this.notifications.sendEmailVerification(factor.target, '', code)
      await this.db('mfa_factors').where({ id: factorId }).update({ secret: sha256(code) })
      return { challengeId, factorId, delivered: true }
    }
    // TOTP — the client already has the code; no dispatch.
    return { challengeId, factorId, delivered: false }
  }

  async verifyMfa(challengeId: string, factorId: string, code: string): Promise<BrokeredSession> {
    const ch = this.mfaChallenges.get(challengeId)
    if (!ch || ch.expiresAt < this.now()) {
      this.mfaChallenges.delete(challengeId)
      throw new UnauthorizedError('invalid or expired challenge')
    }
    const factor = await this.db('mfa_factors')
      .where({ id: factorId, user_id: ch.userId, status: 'active' })
      .first()
    if (!factor) throw new UnauthorizedError('factor not found')
    const ok = await this.verifyFactorCode(factor, code)
    if (!ok) throw new UnauthorizedError('invalid code')
    this.mfaChallenges.delete(challengeId)
    const user = await this.loadUser(ch.userId)
    return this.mintSession(user)
  }

  // ── Contact-ownership verification ────────────────────────────────────────
  async startEmailVerification(token: string | null, email?: string): Promise<void> {
    let userId: string | null = null
    let target = email
    if (token) {
      const { user } = await this.getUserInfo(token)
      userId = user.id
      target = target || user.email
    }
    if (!target) throw new InvalidInputError('email is required')

    // Degrade mode: verification not required (flag off) or no email-service
    // wired — auto-verify the local projection and log. Never strand the user on
    // an undeliverable challenge.
    if (!emailVerificationEnabled()) {
      // Resolve by EMAIL when there is no token: the signup path calls this with
      // an address and no session, so `userId` is null there. Gating the update
      // on `userId` meant that path updated NOTHING while still logging
      // "auto-verified" — the account stayed unverified and the log said
      // otherwise. Harmless while the flag is off, but it strands exactly those
      // accounts the moment REQUIRE_EMAIL_VERIFICATION is switched on.
      const updated = userId
        ? await this.db('users').where({ id: userId }).update({ email_verified: true })
        : await this.db('users').where({ email: target }).update({ email_verified: true })

      // Log what actually happened. `updated === 0` is legitimate (the user row
      // may not be synced yet mid-signup) but it must not read as success.
      console.warn(
        updated
          ? `[security] email verification degraded (auto-verified ${maskContact(
              target,
            )}); set REQUIRE_EMAIL_VERIFICATION=true + EMAIL_SERVICE_URL to enforce.`
          : `[security] email verification degraded and NO user row matched ${maskContact(
              target,
            )} — left unverified; it will be promoted on first login via the OIDC email_verified claim.`,
      )
      return
    }

    const linkToken = crypto.randomBytes(32).toString('hex')
    const code = ('' + crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    await this.db('email_verifications').insert({
      id: uuidv4(),
      user_id: userId,
      email: target,
      token_hash: sha256(linkToken),
      code_hash: sha256(code),
      expires_at: new Date(this.now() + EMAIL_VERIFY_TTL_MS),
      consumed: false,
    })
    await this.notifications.sendEmailVerification(target, linkToken, code)
  }

  async confirmEmailVerification(input: { token?: string; code?: string }): Promise<VerificationStatus> {
    if (!input.token && !input.code) throw new InvalidInputError('token or code is required')
    const q = this.db('email_verifications').where({ consumed: false })
    if (input.token) q.andWhere({ token_hash: sha256(input.token) })
    else q.andWhere({ code_hash: sha256(input.code as string) })
    const row = await q.first()
    if (!row || new Date(row.expires_at).getTime() < this.now()) {
      throw new UnauthorizedError('invalid or expired verification')
    }
    await this.db('email_verifications').where({ id: row.id }).update({ consumed: true })
    if (row.user_id) {
      await this.db('users').where({ id: row.user_id }).update({ email_verified: true })
    }
    return { emailVerified: true, phoneVerified: false }
  }

  async startPhoneVerification(token: string, phone: string): Promise<void> {
    if (!phone) throw new InvalidInputError('phone is required')
    const { user } = await this.getUserInfo(token)
    await this.db('users').where({ id: user.id }).update({ phone })
    await this.notifications.sendSmsOtp(phone)
  }

  async confirmPhoneVerification(phone: string, code: string): Promise<VerificationStatus> {
    const ok = await this.notifications.checkSmsOtp(phone, code)
    if (!ok) throw new UnauthorizedError('invalid or expired code')
    await this.db('users').where({ phone }).update({ phone_verified: true })
    return { emailVerified: false, phoneVerified: true, phone }
  }

  async getVerificationStatus(token: string): Promise<VerificationStatus> {
    const decoded = this.verifySessionToken(token)
    const row = await this.db('users').where({ id: decoded.userId }).first()
    if (!row) throw new UnauthorizedError('user not found')
    return {
      emailVerified: !!row.email_verified,
      phoneVerified: !!row.phone_verified,
      phone: row.phone || undefined,
    }
  }
}

function rowToFactor(row: any): MfaFactor {
  return {
    factorId: row.id,
    type: row.type,
    status: row.status,
    label: row.label || undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
  }
}
