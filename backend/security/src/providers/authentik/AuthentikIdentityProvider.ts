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
import {
  authentikSignup as defaultSignup,
  EnrollmentConflictError,
  authentikSetPassword as defaultSetPassword,
} from '../../services/authentikPassword'
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
  SessionContext,
  SessionDevice,
  SocialConnection,
  IdentityConnections,
  SocialLinkStart,
} from '../IdentityProvider'
import {
  findUserPk,
  findOrCreateUserPk,
  ensureOAuthConnection,
  listOAuthConnections,
  deleteOAuthConnection,
  setUserPassword,
  PasswordPolicyError,
} from './accountApi'
import {
  googleOidcService as defaultGoogleClient,
  type GoogleIdentity,
} from '../../services/googleOidc'
import { syncUserToDatabase as defaultSyncUser } from '../../services/oidc'
import { googleBrokeredEnabled } from './config'
import { parseUserAgent } from './userAgent'
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

/**
 * Thrown when an addressed resource does not exist for the CALLER (maps to 404).
 *
 * Only used where the contract specifies 404 and the existence of the resource
 * is not itself sensitive — e.g. unlinking a provider the account has not
 * linked. Never used to distinguish another account's resources.
 */
export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

type Db = typeof defaultDb

interface SocialState {
  codeVerifier: string
  redirectTo: string
  expiresAt: number
  /**
   * How this handshake was launched — `brokered` exchanges the code with Google
   * DIRECTLY (browser never sees Authentik); `source` is the legacy Authentik
   * `/source/oauth/*` fallback, redeemed via the IdP OIDC client. TODO(redis):
   * externalize for multi-replica — see [[Redis externalization]].
   */
  mode: 'brokered' | 'source'
}
interface MfaChallenge {
  userId: string
  expiresAt: number
}
/** An in-flight LINK handshake, bound to the account that started it. */
interface SocialLinkState {
  codeVerifier: string
  /** The signed-in account the provider will be attached to. */
  userId: string
  /** That account's email at start — the identity the callback must return. */
  email: string
  provider: string
  redirectTo: string
  expiresAt: number
  /** Same brokered-vs-legacy-source semantics as SocialState.mode. */
  mode: 'brokered' | 'source'
}

/**
 * The social providers FuzeFront exposes. Neutral slugs; they happen to match
 * the identity store's source slugs, which is why `startSocialLogin` can build a
 * source path from one — so this guard is also what stops a new provider being
 * silently routed through another's source.
 */
const SUPPORTED_SOCIAL_PROVIDERS = new Set(['google'])

const CHALLENGE_TTL_MS = 5 * 60_000
const EMAIL_VERIFY_TTL_MS = 30 * 60_000
/** Reset tokens are short-lived — they are a credential-change capability. */
const PASSWORD_RESET_TTL_MS = 30 * 60_000

/**
 * Password reset needs only a deliverable email channel — unlike registration
 * verification it has no release flag, because a reset is always user-initiated
 * and never blocks signup. With no `EMAIL_SERVICE_URL` we GRACEFULLY DEGRADE:
 * mint nothing, log, and still resolve, so the route's unconditional 202 holds
 * and no user is stranded on an undeliverable token.
 */
function passwordResetEnabled(): boolean {
  return !!(process.env.EMAIL_SERVICE_URL && process.env.EMAIL_SERVICE_URL.trim())
}

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
  /** Sets the credential in the identity store (never a local hash). */
  setPasswordFn: (email: string, newPassword: string) => Promise<void>
  /** Injected M2M provisioning (defaults to the absorbed machine-identity module). */
  provisionM2M?: (name: string, scopes: string[]) => Promise<M2MClient>
  issueM2M?: (input: M2MTokenInput) => Promise<M2MToken>
  introspectM2M?: (token: string) => Promise<TokenIntrospection>
  /** Server-brokered Google OAuth2/OIDC client (defaults to googleOidcService). */
  googleClient: {
    isInitialized(): boolean
    initialize(): Promise<void>
    generateAuthUrl(state: string): { url: string; codeVerifier: string }
    handleCallback(code: string, state: string, codeVerifier: string): Promise<GoogleIdentity>
  }
  /** Projects validated social claims into the local `users` row (+ event). */
  syncUser: (userinfo: any) => Promise<BrokeredUser>
  /** Provisions/links the social account IN the identity store (find-or-create + connection). */
  provisionSocialUser: (identity: GoogleIdentity, provider: string) => Promise<void>
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
  private setPasswordFn: (email: string, newPassword: string) => Promise<void>
  private provisionM2MFn?: (name: string, scopes: string[]) => Promise<M2MClient>
  private issueM2MFn?: (input: M2MTokenInput) => Promise<M2MToken>
  private introspectM2MFn?: (token: string) => Promise<TokenIntrospection>
  private googleClient: AuthentikProviderDeps['googleClient']
  private syncUserFn: (userinfo: any) => Promise<BrokeredUser>
  private provisionSocialUserFn: (identity: GoogleIdentity, provider: string) => Promise<void>

  private socialStates = new Map<string, SocialState>()
  private socialLinkStates = new Map<string, SocialLinkState>()
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
    this.setPasswordFn = deps.setPasswordFn ?? defaultSetPassword
    this.provisionM2MFn = deps.provisionM2M
    this.issueM2MFn = deps.issueM2M
    this.introspectM2MFn = deps.introspectM2M
    this.googleClient = deps.googleClient ?? defaultGoogleClient
    this.syncUserFn =
      deps.syncUser ??
      (async (userinfo) => {
        const user = await defaultSyncUser(userinfo)
        return { ...user, roles: user.roles ?? [] } as BrokeredUser
      })
    this.provisionSocialUserFn =
      deps.provisionSocialUser ??
      (async (identity, provider) => {
        // Provision/link IN the identity store so the IdP stays system-of-record
        // and password+Google de-dupe to ONE account by email.
        const pk = await findOrCreateUserPk(identity.email, identity.firstName, identity.lastName)
        await ensureOAuthConnection(pk, provider, identity.sub)
      })
  }

  // ── Session minting ───────────────────────────────────────────────────────
  private async mintSession(user: BrokeredUser, ctx?: SessionContext): Promise<BrokeredSession> {
    const sessionId = uuidv4()
    const expiresAt = new Date(this.now() + SESSION_TTL_MS)
    const token = jwt.sign({ userId: user.id, sessionId }, jwtSecret(), {
      expiresIn: '24h',
    })
    await this.db('sessions').insert({
      id: sessionId,
      user_id: user.id,
      expires_at: expiresAt,
      // Device telemetry for manage-devices. Recorded once, at mint time: it
      // describes where the session was ESTABLISHED from, which is what makes a
      // session recognisable to its owner. Truncated because the user-agent is
      // caller-controlled and otherwise unbounded.
      ip: ctx?.ip ? String(ctx.ip).slice(0, 64) : null,
      user_agent: ctx?.userAgent ? String(ctx.userAgent).slice(0, 512) : null,
      last_seen_at: new Date(this.now()),
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
  private async sessionOrChallenge(
    user: BrokeredUser,
    ctx?: SessionContext
  ): Promise<BrokeredSession> {
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
    return this.mintSession(user, ctx)
  }

  // ── Password login ────────────────────────────────────────────────────────
  async passwordLogin(input: PasswordLoginInput, ctx?: SessionContext): Promise<BrokeredSession> {
    if (!input?.email || !input?.password) {
      throw new InvalidInputError('email and password are required')
    }
    const user = await this.passwordLoginFn(input.email, input.password)
    // A successful password login PROVES a password sign-in method exists —
    // the one truthful signal available for legacy rows whose has_password is
    // still unknown (the identity store exposes no read path for it).
    await this.markHasPassword(user.id, true)
    return this.sessionOrChallenge(user, ctx)
  }

  /**
   * Record known password state on the local projection.
   *
   * Only ever called where we have PROOF (a successful password login, an
   * enrollment we drove, a set-password we performed) — never a guess. See
   * migration 013 for why NULL/unknown exists and how it is resolved.
   */
  private async markHasPassword(userId: string, value: boolean): Promise<void> {
    try {
      await this.db('users').where({ id: userId }).update({ has_password: value })
    } catch (err) {
      // Never fail a sign-in over a projection write.
      console.error('[security] has_password projection update failed: %s', (err as Error).message)
    }
  }

  // ── Social login (server-brokered; browser never sees an internal host) ────
  //
  // Dispatch: the DEFAULT path (`googleBrokeredEnabled()`) sends the browser
  // STRAIGHT to accounts.google.com and exchanges the code with Google directly,
  // so no Authentik `/if/*` UI is ever rendered. The legacy Authentik
  // `/source/oauth/*` source-redirect path is kept as a fallback (flag off) until
  // the brokered path is proven.
  async startSocialLogin(provider: string, redirectTo = '/'): Promise<SocialLoginStart> {
    if (provider !== 'google') {
      throw new InvalidInputError(`unsupported social provider: ${provider}`)
    }
    // Reject non-same-origin return targets (open-redirect guard).
    if (/^https?:\/\//i.test(redirectTo) || redirectTo.startsWith('//')) {
      throw new InvalidInputError('redirectTo must be a same-origin path')
    }
    if (googleBrokeredEnabled()) {
      return this.startGoogleBrokered(redirectTo)
    }
    return this.startSocialLoginViaSource(provider, redirectTo)
  }

  /**
   * SERVER-BROKERED start: 302 the browser DIRECTLY to accounts.google.com with
   * FuzeFront's Google client_id, a server-generated state + PKCE code_verifier,
   * and `redirect_uri = <app>/api/v1/security/social/google/callback`. The
   * verifier is held in the process-local Map (single replica) —
   * TODO(redis): externalize for multi-replica — see [[Redis externalization]].
   */
  private async startGoogleBrokered(redirectTo: string): Promise<SocialLoginStart> {
    if (!this.googleClient.isInitialized()) {
      await this.googleClient.initialize()
    }
    const state = crypto.randomBytes(24).toString('hex')
    const { url, codeVerifier } = this.googleClient.generateAuthUrl(state)
    this.socialStates.set(state, {
      codeVerifier,
      redirectTo,
      expiresAt: this.now() + 10 * 60_000,
      mode: 'brokered',
    })
    // `url` is the absolute accounts.google.com authorize URL — the ONLY external
    // host the browser is allowed to see besides app.fuzefront.com.
    return { redirectUrl: url, state, codeVerifier }
  }

  /** Legacy Authentik source-redirect start (fallback; browser transits `/if/*`). */
  private async startSocialLoginViaSource(provider: string, redirectTo = '/'): Promise<SocialLoginStart> {
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
      mode: 'source',
    })
    // codeVerifier is handed back so the route can persist it in an HttpOnly
    // cookie (`oidc_cv`) for the replica-agnostic OIDC callback.
    return { redirectUrl, state, codeVerifier }
  }

  async brokerCallback(
    input: SocialCallbackInput,
    ctx?: SessionContext
  ): Promise<SocialCallbackResult> {
    // A LINK handshake (started by a signed-in user via startSocialLink) shares
    // this callback but must NOT mint a session — it attaches a provider to the
    // account that is already signed in. Checked first so a link state can never
    // fall through into the sign-in path.
    const link = this.socialLinkStates.get(input.state)
    if (link) {
      this.socialLinkStates.delete(input.state)
      return this.completeSocialLink(input, link)
    }

    const st = this.socialStates.get(input.state)
    if (!st || st.expiresAt < this.now()) {
      this.socialStates.delete(input.state)
      throw new UnauthorizedError('invalid or expired state')
    }
    this.socialStates.delete(input.state)

    let user: BrokeredUser
    if (st.mode === 'brokered') {
      // Exchange the code with Google DIRECTLY (server-to-server), validate the
      // id_token, provision/link in the identity store, then sync the local
      // projection through the SAME path the OIDC callback uses.
      const identity = await this.googleClient.handleCallback(
        input.code,
        input.state,
        st.codeVerifier
      )
      await this.provisionSocialUserFn(identity, 'google')
      user = await this.syncUserFn({
        email: identity.email,
        email_verified: identity.emailVerified,
        given_name: identity.firstName,
        family_name: identity.lastName,
      })
    } else {
      user = (await this.oidc.handleCallback(
        input.code,
        input.state,
        st.codeVerifier
      )) as BrokeredUser
    }

    // Mint the session now and hand back a single-use opaque code (never a token
    // in the URL). Social sign-in does not re-gate MFA at the browser hop.
    const session = await this.mintSession(user, ctx)
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
  async signup(input: SignupInput, ctx?: SessionContext): Promise<BrokeredSession> {
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

    // Enrollment always sets a password, so this account demonstrably HAS a
    // password sign-in method — record it (this is proof, not a guess).
    await this.markHasPassword(user.id, true)

    // Gate through MFA step-up if the (rare, freshly-enrolled) account already
    // has active factors — otherwise mint the session directly.
    return this.sessionOrChallenge(user, ctx)
  }

  /**
   * Existence check against the SAME source of truth `signup` consults — the
   * synced `users` projection (see signup's fast-path conflict at :569). Matched
   * case-insensitively so a differently-cased address resolves to the same
   * account. Returns only a boolean; it never loads or leaks the account row.
   */
  async emailExists(email: string): Promise<boolean> {
    const normalized = (email ?? '').trim().toLowerCase()
    if (!normalized) return false
    const existing = await this.db('users')
      .whereRaw('LOWER(email) = ?', [normalized])
      .first()
    return !!existing
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

  async verifyMfa(
    challengeId: string,
    factorId: string,
    code: string,
    ctx?: SessionContext
  ): Promise<BrokeredSession> {
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
    return this.mintSession(user, ctx)
  }

  // ── Self-service password reset ───────────────────────────────────────────
  /**
   * Begin a reset. Unconditionally resolves — an unknown address, a disabled
   * email channel, and a real dispatch are INDISTINGUISHABLE to the caller, so
   * the route's 202 leaks nothing about account existence.
   */
  async requestPasswordReset(email: string): Promise<void> {
    if (!email || typeof email !== 'string') {
      throw new InvalidInputError('email is required')
    }

    // Degrade mode: no email channel wired — a reset token would be
    // undeliverable, so mint nothing and log. Still resolves (no enumeration).
    if (!passwordResetEnabled()) {
      console.warn(
        `[security] password reset requested for ${maskContact(email)} but no email ` +
          'channel is configured — nothing dispatched. Set EMAIL_SERVICE_URL to enable.'
      )
      return
    }

    const user = await this.db('users').whereRaw('LOWER(email) = ?', [email.toLowerCase()]).first()
    if (!user) {
      // Unknown address: do the same nothing, tell the caller the same nothing.
      console.warn(
        `[security] password reset requested for unknown address ${maskContact(email)} — no-op.`
      )
      return
    }

    // Invalidate any outstanding challenge for this user, so a reset request
    // supersedes its predecessors rather than leaving several live tokens.
    await this.db('password_resets')
      .where({ user_id: user.id, consumed: false })
      .update({ consumed: true })

    const resetToken = crypto.randomBytes(32).toString('hex')
    await this.db('password_resets').insert({
      id: uuidv4(),
      user_id: user.id,
      email: user.email,
      token_hash: sha256(resetToken),
      expires_at: new Date(this.now() + PASSWORD_RESET_TTL_MS),
      consumed: false,
    })

    try {
      await this.notifications.sendPasswordReset(user.email, resetToken)
    } catch (err) {
      // Dispatch failure must not become an enumeration oracle (a 5xx for real
      // accounts only). Burn the token and resolve; the user can retry.
      await this.db('password_resets')
        .where({ token_hash: sha256(resetToken) })
        .update({ consumed: true })
      console.error(
        `[security] password reset dispatch failed for ${maskContact(user.email)}:`,
        err
      )
    }
  }

  /**
   * Complete a reset: validate the single-use token, set the credential in the
   * identity store, consume the token, then REVOKE EVERY SESSION for the account
   * — a password reset must not leave a pre-reset session alive (that is the
   * whole point when the reset follows a compromise).
   */
  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    if (!token || typeof token !== 'string') {
      throw new InvalidInputError('token is required')
    }
    if (!newPassword || typeof newPassword !== 'string') {
      throw new InvalidInputError('newPassword is required')
    }

    const row = await this.db('password_resets')
      .where({ token_hash: sha256(token), consumed: false })
      .first()
    // Unknown, already-consumed, and expired all fail identically.
    if (!row || new Date(row.expires_at).getTime() < this.now()) {
      throw new InvalidInputError('invalid or expired reset token')
    }

    const user = await this.db('users').where({ id: row.user_id }).first()
    if (!user) throw new InvalidInputError('invalid or expired reset token')

    // Set the credential in the identity store FIRST. If this throws (policy
    // rejection / store unavailable) the token stays live so a valid retry with
    // a compliant password still works.
    await this.setPasswordFn(user.email, newPassword)

    await this.db('password_resets').where({ id: row.id }).update({ consumed: true })

    // Revoke all sessions. `authenticateToken` enforces the sessions table, so
    // deleting these genuinely signs the account out everywhere.
    const revoked = await this.db('sessions').where({ user_id: user.id }).del()
    console.warn(
      `[security] password reset completed for ${maskContact(user.email)}; ` +
        `revoked ${revoked} session(s).`
    )
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

  // ── Manage devices (platform sessions) ────────────────────────────────────
  //
  // These read/write FuzeFront's OWN `sessions` table — the store that
  // `authenticateToken` checks on every request. That is what makes revocation
  // REAL rather than cosmetic: deleting the row invalidates the token on its
  // next use, with no waiting for the JWT to expire.
  //
  // The identity vendor's own session objects are deliberately NOT surfaced:
  // the platform session is the browser-facing truth, and exposing the vendor's
  // would leak it across the provider boundary.

  async listSessions(token: string): Promise<SessionDevice[]> {
    // getUserInfo enforces that the CALLER's own session is still live, so a
    // revoked token cannot enumerate the account's devices.
    const { user } = await this.getUserInfo(token)
    const decoded = this.verifySessionToken(token)

    const rows = await this.db('sessions').where({ user_id: user.id }).select('*')
    const nowMs = this.now()
    return rows
      // Expired-but-not-yet-reaped rows are not "active" — showing them would
      // invite a user to revoke a session that already carries no access.
      .filter(r => !r.expires_at || new Date(r.expires_at).getTime() > nowMs)
      .map(r => {
        const ua = parseUserAgent(r.user_agent)
        return {
          id: r.id,
          device: ua.device,
          browser: ua.browser,
          os: ua.os,
          ip: r.ip ?? null,
          // Coarse geolocation needs a geo-IP source we do not deploy; the
          // contract types it nullable, so report null rather than invent one.
          geo: null,
          lastSeenAt: r.last_seen_at
            ? new Date(r.last_seen_at).getTime()
            : r.created_at
              ? new Date(r.created_at).getTime()
              : undefined,
          current: r.id === decoded.sessionId,
        }
      })
      .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
  }

  async revokeSession(token: string, sessionId: string): Promise<void> {
    const { user } = await this.getUserInfo(token)
    // Scoped to the caller's own user_id: this is the object-level authorization
    // check. Without it any signed-in user could revoke anyone's session by id.
    // A non-matching id deletes nothing — idempotent, and it does not disclose
    // whether that session exists on another account.
    await this.db('sessions').where({ id: sessionId, user_id: user.id }).del()
  }

  async revokeOtherSessions(token: string): Promise<void> {
    const { user } = await this.getUserInfo(token)
    const decoded = this.verifySessionToken(token)
    const q = this.db('sessions').where({ user_id: user.id })
    if (decoded.sessionId) {
      // Keep the caller's own session — "sign out everywhere else" must not sign
      // the caller out.
      q.whereNot({ id: decoded.sessionId })
    }
    await q.del()
  }

  // ── Account sign-in connections ───────────────────────────────────────────

  /** Map identity-store source slugs to neutral provider slugs (unknown → dropped). */
  private toNeutralConnections(
    conns: Array<{ sourceSlug: string; createdAt?: number }>
  ): SocialConnection[] {
    return conns
      .filter(c => SUPPORTED_SOCIAL_PROVIDERS.has(c.sourceSlug))
      .map(c => ({ provider: c.sourceSlug, linkedAt: c.createdAt }))
  }

  /**
   * Read the account's sign-in methods.
   *
   * Social links come from the identity store (authoritative). `hasPassword`
   * comes from our local projection because the store exposes NO read path for
   * password state — see migration 013. Unknown (NULL) reports FALSE: the safe
   * reading, since it drives the UI to offer "set a password" and makes the
   * unlink guard refuse rather than risk a lockout.
   */
  async getIdentityConnections(token: string): Promise<IdentityConnections> {
    const { user } = await this.getUserInfo(token)
    return this.connectionsForUser(user)
  }

  private async connectionsForUser(user: BrokeredUser): Promise<IdentityConnections> {
    const pk = await findUserPk(user.email)
    const conns = await listOAuthConnections(pk)
    const row = await this.db('users').where({ id: user.id }).first()
    return {
      providers: this.toNeutralConnections(conns),
      hasPassword: row?.has_password === true,
    }
  }

  async startSocialLink(token: string, provider: string): Promise<SocialLinkStart> {
    if (!SUPPORTED_SOCIAL_PROVIDERS.has(provider)) {
      throw new InvalidInputError(`unsupported social provider: ${provider}`)
    }
    const { user } = await this.getUserInfo(token)

    // Already linked ⇒ CONFLICT, per the contract.
    const current = await this.connectionsForUser(user)
    if (current.providers.some(p => p.provider === provider)) {
      throw new ConflictError(`${provider} is already linked to this account`)
    }

    const state = crypto.randomBytes(24).toString('hex')
    let redirectUrl: string
    let codeVerifier: string
    let mode: 'brokered' | 'source'

    if (googleBrokeredEnabled()) {
      // Server-brokered LINK: same as sign-in, the browser only transits the app
      // host and accounts.google.com — never Authentik's `/if/*` UI.
      if (!this.googleClient.isInitialized()) {
        await this.googleClient.initialize()
      }
      const gen = this.googleClient.generateAuthUrl(state)
      redirectUrl = gen.url
      codeVerifier = gen.codeVerifier
      mode = 'brokered'
    } else {
      if (!this.oidc.isInitialized()) {
        await this.oidc.initialize()
      }
      const { url, codeVerifier: cv } = this.oidc.generateAuthUrl(state)
      const authorize = new URL(url)
      const authorizePath = `${idpProxyPrefix()}${authorize.pathname}${authorize.search}`
      // Same same-host boundary rewrite as sign-in: the browser only ever transits
      // the app host and the social provider's own consent host.
      redirectUrl =
        `${idpProxyPrefix()}/source/oauth/login/${provider}/` +
        `?next=${encodeURIComponent(authorizePath)}`
      codeVerifier = cv
      mode = 'source'
    }

    this.socialLinkStates.set(state, {
      codeVerifier,
      userId: user.id,
      email: user.email,
      provider,
      redirectTo: '/account/security',
      expiresAt: this.now() + 10 * 60_000,
      mode,
    })
    return { redirectUrl, state, codeVerifier }
  }

  /**
   * Finish a LINK handshake.
   *
   * The identity store performs the actual attachment when its source flow runs.
   * Our job is the SAFETY check the store cannot make for us: that the identity
   * that came back is the same account that started the handshake. Without this
   * equality check, completing the flow while signed in as someone else would
   * bind a stranger's social identity to this account (or this one to theirs) —
   * an account-takeover primitive. Mismatch fails closed.
   *
   * Known limitation: because the browser transits the store's source flow, the
   * store may have already matched/created its own account for that social
   * identity before we can object. We reject the LINK (no session is minted, and
   * nothing is attached to the caller's account), but we do not attempt to undo
   * the store's own bookkeeping.
   */
  private async completeSocialLink(
    input: SocialCallbackInput,
    link: SocialLinkState
  ): Promise<SocialCallbackResult> {
    if (link.expiresAt < this.now()) {
      throw new UnauthorizedError('invalid or expired state')
    }

    let identityEmail: string | undefined
    if (link.mode === 'brokered') {
      // Exchange with Google directly, then WE attach the connection (the browser
      // no longer transited Authentik's source flow, so the store did not).
      const identity = await this.googleClient.handleCallback(
        input.code,
        input.state,
        link.codeVerifier
      )
      identityEmail = identity.email
      // Safety: the returned identity must be the SAME account that started the
      // handshake — otherwise binding it would be an account-takeover primitive.
      if (!identityEmail || identityEmail.toLowerCase() !== link.email.toLowerCase()) {
        throw new UnauthorizedError('social identity does not match the signed-in account')
      }
      await this.provisionSocialUserFn(identity, link.provider)
    } else {
      const identity = (await this.oidc.handleCallback(
        input.code,
        input.state,
        link.codeVerifier
      )) as BrokeredUser
      identityEmail = identity?.email
      if (!identityEmail || identityEmail.toLowerCase() !== link.email.toLowerCase()) {
        throw new UnauthorizedError('social identity does not match the signed-in account')
      }
    }

    // Confirm the store really did attach the connection — never report a link
    // we cannot see.
    const pk = await findUserPk(link.email)
    const conns = await listOAuthConnections(pk)
    if (!conns.some(c => c.sourceSlug === link.provider)) {
      throw new UnauthorizedError('link did not complete')
    }
    return { code: '', redirectTo: link.redirectTo, linked: true, provider: link.provider }
  }

  async unlinkSocial(token: string, provider: string): Promise<IdentityConnections> {
    if (!SUPPORTED_SOCIAL_PROVIDERS.has(provider)) {
      throw new InvalidInputError(`unsupported social provider: ${provider}`)
    }
    const { user } = await this.getUserInfo(token)
    const pk = await findUserPk(user.email)
    const conns = await listOAuthConnections(pk)
    const target = conns.find(c => c.sourceSlug === provider)
    if (!target) throw new NotFoundError(`${provider} is not linked to this account`)

    const row = await this.db('users').where({ id: user.id }).first()
    const hasPassword = row?.has_password === true
    const otherSocial = this.toNeutralConnections(conns).filter(c => c.provider !== provider)

    // THE lockout guard. Fail-closed: an unknown (NULL) has_password counts as
    // NO password, so an unproven account is told to set one first rather than
    // being allowed to remove its last way back in.
    if (!hasPassword && otherSocial.length === 0) {
      throw new ConflictError(
        'Unlinking would leave the account with no sign-in method. Set a password or link another provider first.'
      )
    }

    await deleteOAuthConnection(target.pk)
    return { providers: otherSocial, hasPassword }
  }

  // ── Set password (social-only accounts) ───────────────────────────────────
  //
  // The password is set IN THE IDENTITY STORE, which is the sole authority for
  // credentials. FuzeFront deliberately stores no password hash of its own —
  // a local hash would be a second, divergent credential the store never knows
  // about (exactly the split-brain that server-brokered signup replaced).
  async setPassword(token: string, newPassword: string): Promise<IdentityConnections> {
    if (!newPassword || typeof newPassword !== 'string') {
      throw new InvalidInputError('newPassword is required')
    }
    const { user } = await this.getUserInfo(token)
    const row = await this.db('users').where({ id: user.id }).first()

    // CONFLICT only on PROVEN existing password. An unknown (NULL) legacy row is
    // allowed through: this endpoint adds a first password, and letting an
    // already-authenticated owner set one converges the row to a known state.
    // Changing a KNOWN password goes through the reset flow instead.
    if (row?.has_password === true) {
      throw new ConflictError('A password sign-in method already exists on this account')
    }

    const pk = await findUserPk(user.email)
    try {
      await setUserPassword(pk, newPassword)
    } catch (err) {
      if (err instanceof PasswordPolicyError) {
        throw new InvalidInputError(`password rejected: ${err.message}`)
      }
      throw err
    }
    await this.markHasPassword(user.id, true)
    return this.connectionsForUser(user)
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
