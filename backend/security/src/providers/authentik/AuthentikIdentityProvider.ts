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
import { defaultEventPublisher } from '../../services/eventPublisher'
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

interface PendingCode {
  session: BrokeredSession
  expiresAt: number
}
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

export interface AuthentikProviderDeps {
  db: Db
  oidc: typeof defaultOidc
  passwordLoginFn: (email: string, password: string) => Promise<BrokeredUser>
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
  private notifications: NotificationClient
  private now: () => number
  private provisionM2MFn?: (name: string, scopes: string[]) => Promise<M2MClient>
  private issueM2MFn?: (input: M2MTokenInput) => Promise<M2MToken>
  private introspectM2MFn?: (token: string) => Promise<TokenIntrospection>

  private pendingCodes = new Map<string, PendingCode>()
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
    const redirectUrl = `${idpProxyPrefix()}${authorize.pathname}${authorize.search}`

    this.socialStates.set(state, {
      codeVerifier,
      redirectTo,
      expiresAt: this.now() + 10 * 60_000,
    })
    return { redirectUrl, state }
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
    this.pendingCodes.set(code, { session, expiresAt: this.now() + CODE_TTL_MS })
    return { code, redirectTo: st.redirectTo || '/' }
  }

  async exchangeCode(code: string): Promise<BrokeredSession> {
    const pending = this.pendingCodes.get(code)
    if (!pending || pending.expiresAt < this.now()) {
      this.pendingCodes.delete(code)
      throw new UnauthorizedError('invalid or expired code')
    }
    this.pendingCodes.delete(code) // single-use
    return pending.session
  }

  // ── Signup (server-brokered) ──────────────────────────────────────────────
  async signup(input: SignupInput): Promise<BrokeredSession> {
    if (!input?.email || !input?.password) {
      throw new InvalidInputError('email and password are required')
    }
    const bcrypt = await import('bcryptjs')
    const existing = await this.db('users').where('email', input.email).first()
    if (existing) throw new ConflictError()

    const id = uuidv4()
    const passwordHash = await bcrypt.hash(input.password, 10)
    const correlationId = `identity-${id}`
    const row = {
      id,
      email: input.email,
      password_hash: passwordHash,
      first_name: input.firstName ?? null,
      last_name: input.lastName ?? null,
      roles: JSON.stringify(['user']),
      created_at: new Date(),
      updated_at: new Date(),
    }
    await this.db.transaction(async (trx: any) => {
      await trx('users').insert(row)
      await trx('event_outbox').insert({
        id: uuidv4(),
        topic: 'identity.user.created',
        payload: JSON.stringify({
          userId: id,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          intent: 'signup',
          tenantName: input.tenantName,
        }),
        correlation_id: correlationId,
        status: 'pending',
        attempts: 0,
      })
    })
    // Best-effort publish; the outbox row is the durable record.
    try {
      await defaultEventPublisher.publishIdentityUserCreated(
        {
          userId: id,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          intent: 'signup',
        },
        correlationId
      )
      await this.db('event_outbox')
        .where({ correlation_id: correlationId })
        .update({ status: 'sent', attempts: 1, sent_at: new Date() })
    } catch (pubErr) {
      console.error('⚠️ identity.user.created publish failed (outbox retains it):', pubErr)
    }

    const user: BrokeredUser = {
      id,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      roles: ['user'],
    }
    return this.mintSession(user)
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
