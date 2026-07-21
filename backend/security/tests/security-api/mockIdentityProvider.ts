/**
 * MockIdentityProvider — a fully in-memory implementation of the internal
 * `IdentityProvider` swap contract, used to PROVE provider-agnosticism.
 *
 * It names NO vendor and touches no network. If the whole login + MFA +
 * verification surface works against this mock exactly as the spec describes,
 * that is objective evidence the consumer-facing contract has no coupling to
 * any concrete identity vendor.
 *
 * This is a TEST FIXTURE (a contract mock), NOT the product implementation.
 */
import {
  IdentityProvider,
  BrokeredSession,
  BrokeredUser,
  NormalizedIdentity,
  PasswordLoginInput,
  SignupInput,
  SocialLoginStart,
  SocialCallbackInput,
  SocialCallbackResult,
  M2MClientProvisionInput,
  M2MClient,
  M2MTokenInput,
  M2MToken,
  TokenIntrospection,
  MfaFactor,
  MfaEnrollInput,
  MfaEnrollResult,
  MfaChallengeAck,
  VerificationStatus,
} from '../../src/providers/IdentityProvider'
import { randomUUID } from 'crypto'

/** Provider errors carry a neutral, fail-closed error code (see spec ErrorBody). */
export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 401
  ) {
    super(message)
  }
}

interface StoredUser {
  id: string
  email: string
  password: string
  firstName?: string
  lastName?: string
  roles: string[]
  mfaEnabled: boolean
  factors: MfaFactor[]
  factorSecrets: Map<string, string>
  emailVerified: boolean
  phoneVerified: boolean
  phone?: string
}

// A well-known seeded user the contract tests log in as.
export const SEED = {
  email: 'alice@example.com',
  password: 'correct horse battery staple',
  mfaEmail: 'mfauser@example.com',
  mfaPassword: 'mfa-pass-1234',
  socialCode: 'valid-provider-code',
  socialState: 'valid-state',
  m2mClientId: 'svc-client-1',
  m2mClientSecret: 'svc-secret-1',
}

const OTP = '000000' // the mock's accepted OTP for every challenge/verification

export class MockIdentityProvider implements IdentityProvider {
  private users = new Map<string, StoredUser>()
  private sessions = new Map<string, string>() // token -> userId
  private m2mTokens = new Map<string, { subject: string; scope?: string; exp: number }>()
  private brokerCodes = new Map<string, { userId: string; redirectTo: string }>()
  private mfaChallenges = new Map<string, { userId: string; factorId: string }>()
  private pendingSocialState = new Set<string>([SEED.socialState])

  constructor() {
    this.seedUser({
      email: SEED.email,
      password: SEED.password,
      firstName: 'Alice',
      lastName: 'Example',
      roles: ['user'],
      mfaEnabled: false,
    })
    const mfaUser = this.seedUser({
      email: SEED.mfaEmail,
      password: SEED.mfaPassword,
      firstName: 'Mallory',
      roles: ['user'],
      mfaEnabled: true,
    })
    // Give the MFA user one active TOTP factor.
    mfaUser.factors.push({
      factorId: 'factor-totp-1',
      type: 'totp',
      status: 'active',
      label: 'Authenticator app',
      createdAt: Date.now(),
    })
  }

  private seedUser(u: {
    email: string
    password: string
    firstName?: string
    lastName?: string
    roles: string[]
    mfaEnabled: boolean
  }): StoredUser {
    const stored: StoredUser = {
      id: randomUUID(),
      email: u.email,
      password: u.password,
      firstName: u.firstName,
      lastName: u.lastName,
      roles: u.roles,
      mfaEnabled: u.mfaEnabled,
      factors: [],
      factorSecrets: new Map(),
      emailVerified: false,
      phoneVerified: false,
    }
    this.users.set(u.email.toLowerCase(), stored)
    return stored
  }

  private toUser(s: StoredUser): BrokeredUser {
    return {
      id: s.id,
      email: s.email,
      firstName: s.firstName,
      lastName: s.lastName,
      roles: s.roles,
    }
  }

  private mint(s: StoredUser): BrokeredSession {
    const token = `sess_${randomUUID()}`
    this.sessions.set(token, s.id)
    return { token, sessionId: `sid_${randomUUID()}`, user: this.toUser(s) }
  }

  private userByToken(token: string): StoredUser {
    const userId = this.sessions.get(token)
    if (!userId) throw new ProviderError('INVALID_SIGNATURE', 'unknown session', 401)
    for (const u of this.users.values()) if (u.id === userId) return u
    throw new ProviderError('INVALID_SIGNATURE', 'session user gone', 401)
  }

  /** True when the account requires MFA step-up (surfaced by the route as SessionResult). */
  requiresMfa(email: string): boolean {
    const u = this.users.get(email.toLowerCase())
    return !!u && u.mfaEnabled
  }

  factorsFor(email: string): MfaFactor[] {
    const u = this.users.get(email.toLowerCase())
    return u ? u.factors : []
  }

  async passwordLogin(input: PasswordLoginInput): Promise<BrokeredSession> {
    const u = this.users.get(input.email.toLowerCase())
    if (!u || u.password !== input.password) {
      throw new ProviderError('INVALID_CREDENTIALS', 'bad credentials', 401)
    }
    return this.mint(u)
  }

  async startSocialLogin(provider: string, redirectTo?: string): Promise<SocialLoginStart> {
    if (provider !== 'google') {
      throw new ProviderError('MALFORMED', `unsupported provider ${provider}`, 400)
    }
    const state = `state_${randomUUID()}`
    this.pendingSocialState.add(state)
    // FuzeFront-OWNED same-host authorize path. Never an internal identity host.
    const url = new URL('https://app.fuzefront.com/api/auth/idp/authorize')
    url.searchParams.set('state', state)
    if (redirectTo) url.searchParams.set('redirectTo', redirectTo)
    return { redirectUrl: url.toString(), state }
  }

  async brokerCallback(input: SocialCallbackInput): Promise<SocialCallbackResult> {
    if (
      !this.pendingSocialState.has(input.state) ||
      (input.code !== SEED.socialCode && !input.code.startsWith('state_') && input.code.length < 3)
    ) {
      throw new ProviderError('INVALID_CODE', 'bad state/code', 401)
    }
    // Provision/link the social user.
    let u = this.users.get('social@example.com')
    if (!u) {
      u = this.seedUser({
        email: 'social@example.com',
        password: randomUUID(),
        firstName: 'Soc',
        roles: ['user'],
        mfaEnabled: false,
      })
    }
    const code = `broker_${randomUUID()}`
    this.brokerCodes.set(code, { userId: u.id, redirectTo: '/dashboard' })
    return { code, redirectTo: '/dashboard' }
  }

  async exchangeCode(code: string): Promise<BrokeredSession> {
    const entry = this.brokerCodes.get(code)
    if (!entry) throw new ProviderError('INVALID_CODE', 'unknown/expired code', 401)
    this.brokerCodes.delete(code) // single-use
    for (const u of this.users.values()) if (u.id === entry.userId) return this.mint(u)
    throw new ProviderError('INVALID_CODE', 'user gone', 401)
  }

  async signup(input: SignupInput): Promise<BrokeredSession> {
    if (this.users.has(input.email.toLowerCase())) {
      throw new ProviderError('CONFLICT', 'email exists', 409)
    }
    const u = this.seedUser({
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      roles: ['user'],
      mfaEnabled: false,
    })
    return this.mint(u)
  }

  async emailExists(email: string): Promise<boolean> {
    return this.users.has((email ?? '').trim().toLowerCase())
  }

  async getUserInfo(
    token: string
  ): Promise<{ identity: NormalizedIdentity; user: BrokeredUser }> {
    const u = this.userByToken(token)
    const now = Math.floor(Date.now() / 1000)
    return {
      identity: {
        userId: u.id,
        tenantId: null,
        roles: u.roles,
        email: u.email,
        authMode: 'legacy-hs256',
        issuedAt: now,
        expiresAt: now + 3600,
        issuer: 'https://app.fuzefront.com',
      },
      user: this.toUser(u),
    }
  }

  async logout(token: string): Promise<void> {
    this.sessions.delete(token) // idempotent
  }

  async provisionM2MClient(input: M2MClientProvisionInput): Promise<M2MClient> {
    return { clientId: `svc_${randomUUID()}`, clientSecret: randomUUID(), scope: input.scope }
  }

  async issueM2MToken(input: M2MTokenInput): Promise<M2MToken> {
    if (input.clientId !== SEED.m2mClientId || input.clientSecret !== SEED.m2mClientSecret) {
      throw new ProviderError('INVALID_CREDENTIALS', 'bad client credentials', 401)
    }
    const accessToken = `m2m_${randomUUID()}`
    const exp = Math.floor(Date.now() / 1000) + 3600
    this.m2mTokens.set(accessToken, { subject: input.clientId, scope: input.scope, exp })
    return { accessToken, tokenType: 'Bearer', expiresIn: 3600, scope: input.scope }
  }

  async introspectToken(token: string): Promise<TokenIntrospection> {
    const entry = this.m2mTokens.get(token)
    if (!entry || entry.exp < Math.floor(Date.now() / 1000)) {
      return { active: false } // fail-closed
    }
    return {
      active: true,
      subject: entry.subject,
      tenantId: null,
      scope: entry.scope,
      expiresAt: entry.exp,
    }
  }

  async listFactors(token: string): Promise<MfaFactor[]> {
    return this.userByToken(token).factors
  }

  async enrollFactor(token: string, input: MfaEnrollInput): Promise<MfaEnrollResult> {
    const u = this.userByToken(token)
    if (input.type === 'sms' && !input.phone)
      throw new ProviderError('MALFORMED', 'phone required for sms', 400)
    if (input.type === 'email' && !input.email)
      throw new ProviderError('MALFORMED', 'email required for email', 400)
    const factorId = `factor_${randomUUID()}`
    const factor: MfaFactor = {
      factorId,
      type: input.type,
      status: 'pending',
      label: input.phone || input.email || input.type,
      createdAt: Date.now(),
    }
    u.factors.push(factor)
    const result: MfaEnrollResult = { factorId, type: input.type, status: 'pending' }
    if (input.type === 'totp') {
      const secret = 'JBSWY3DPEHPK3PXP'
      u.factorSecrets.set(factorId, secret)
      result.secret = secret
      result.provisioningUri = `otpauth://totp/FuzeFront:${u.email}?secret=${secret}&issuer=FuzeFront`
    } else {
      result.codeSent = true
    }
    return result
  }

  async activateFactor(token: string, factorId: string, code: string): Promise<MfaFactor> {
    const u = this.userByToken(token)
    const factor = u.factors.find((f) => f.factorId === factorId)
    if (!factor) throw new ProviderError('NOT_FOUND', 'no such factor', 404)
    if (code !== OTP) throw new ProviderError('INVALID_CODE', 'bad code', 400)
    factor.status = 'active'
    return factor
  }

  async removeFactor(token: string, factorId: string): Promise<void> {
    const u = this.userByToken(token)
    u.factors = u.factors.filter((f) => f.factorId !== factorId) // idempotent
  }

  async regenerateRecoveryCodes(token: string): Promise<string[]> {
    this.userByToken(token)
    return Array.from({ length: 8 }, () => randomUUID().slice(0, 10))
  }

  async challengeMfa(challengeId: string, factorId: string): Promise<MfaChallengeAck> {
    const ch = this.mfaChallenges.get(challengeId)
    if (!ch) throw new ProviderError('INVALID_CODE', 'unknown challenge', 401)
    return { challengeId, factorId, delivered: true }
  }

  async verifyMfa(
    challengeId: string,
    factorId: string,
    code: string
  ): Promise<BrokeredSession> {
    const ch = this.mfaChallenges.get(challengeId)
    if (!ch) throw new ProviderError('INVALID_CODE', 'unknown challenge', 401)
    if (code !== OTP) throw new ProviderError('INVALID_CODE', 'bad code', 401)
    this.mfaChallenges.delete(challengeId)
    for (const u of this.users.values()) if (u.id === ch.userId) return this.mint(u)
    throw new ProviderError('INVALID_CODE', 'user gone', 401)
  }

  /** Called by the route when password login hits an MFA-enabled account. */
  openMfaChallenge(email: string): { challengeId: string; factors: MfaFactor[] } {
    const u = this.users.get(email.toLowerCase())!
    const challengeId = `chal_${randomUUID()}`
    this.mfaChallenges.set(challengeId, { userId: u.id, factorId: u.factors[0]?.factorId })
    return { challengeId, factors: u.factors }
  }

  async startEmailVerification(token: string | null, email?: string): Promise<void> {
    if (!token && !email) throw new ProviderError('MALFORMED', 'need token or email', 400)
    // no-op dispatch
  }

  async confirmEmailVerification(input: {
    token?: string
    code?: string
  }): Promise<VerificationStatus> {
    if (input.token !== 'valid-email-token' && input.code !== OTP) {
      throw new ProviderError('INVALID_CODE', 'bad token/code', 400)
    }
    return { emailVerified: true, phoneVerified: false }
  }

  async startPhoneVerification(token: string, phone: string): Promise<void> {
    this.userByToken(token)
    if (!phone) throw new ProviderError('MALFORMED', 'phone required', 400)
  }

  async confirmPhoneVerification(phone: string, code: string): Promise<VerificationStatus> {
    if (code !== OTP) throw new ProviderError('INVALID_CODE', 'bad code', 400)
    return { emailVerified: false, phoneVerified: true, phone }
  }

  async getVerificationStatus(token: string): Promise<VerificationStatus> {
    const u = this.userByToken(token)
    return { emailVerified: u.emailVerified, phoneVerified: u.phoneVerified, phone: u.phone }
  }
}
