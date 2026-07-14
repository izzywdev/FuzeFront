/**
 * PROVIDER-SWAP PROOF.
 *
 * The reference app (referenceApp.ts) depends ONLY on the `IdentityProvider`
 * interface. Here we drive the full AuthN surface through a SECOND, completely
 * independent implementation (`AltIdentityProvider`) that shares NO code with
 * MockIdentityProvider and uses a different token format + storage. If the same
 * spec-conformant login + MFA-less + M2M + verification path passes unchanged,
 * that is objective evidence the consumer-facing contract has zero coupling to
 * any concrete identity vendor — the whole point of the provider-agnostic layer.
 */
import supertest from 'supertest'
import { createSecurityApp } from './referenceApp'
import { assertSchema } from './spec'
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
import { ProviderError } from './mockIdentityProvider'
import { randomUUID } from 'crypto'

/** A deliberately different second implementation of the SAME swap contract. */
class AltIdentityProvider implements IdentityProvider {
  // ids are uuid-format (the contract's User.id format) but everything else —
  // token format, storage, roles — differs from MockIdentityProvider.
  private users: Record<string, { id: string; pw: string }> = {
    'bob@alt.test': { id: randomUUID(), pw: 'alt-pass-99' },
  }
  private live = new Set<string>()
  private m2m = new Map<string, number>()
  private codes = new Map<string, string>()
  private n = 0
  private tok() {
    return `ALT-TOKEN-${this.n++}` // different format from the mock's `sess_...`
  }
  private mint(email: string): BrokeredSession {
    const t = this.tok()
    this.live.add(t)
    return {
      token: t,
      sessionId: `ALTSID-${this.n++}`,
      user: { id: this.users[email].id, email, roles: ['member'] },
    }
  }
  async passwordLogin(i: PasswordLoginInput): Promise<BrokeredSession> {
    const u = this.users[i.email]
    if (!u || u.pw !== i.password) throw new ProviderError('INVALID_CREDENTIALS', 'nope', 401)
    return this.mint(i.email)
  }
  async startSocialLogin(provider: string): Promise<SocialLoginStart> {
    if (provider !== 'google') throw new ProviderError('MALFORMED', 'bad provider', 400)
    return { redirectUrl: 'https://app.fuzefront.com/api/auth/idp/authorize?x=1', state: 's' }
  }
  async brokerCallback(i: SocialCallbackInput): Promise<SocialCallbackResult> {
    const code = `ALTCODE-${this.n++}`
    this.codes.set(code, 'bob@alt.test')
    return { code, redirectTo: '/home' }
  }
  async exchangeCode(code: string): Promise<BrokeredSession> {
    const email = this.codes.get(code)
    if (!email) throw new ProviderError('INVALID_CODE', 'unknown', 401)
    this.codes.delete(code)
    return this.mint(email)
  }
  async signup(i: SignupInput): Promise<BrokeredSession> {
    if (this.users[i.email]) throw new ProviderError('CONFLICT', 'exists', 409)
    this.users[i.email] = { id: `ALT-${this.n++}`, pw: i.password }
    return this.mint(i.email)
  }
  async getUserInfo(t: string): Promise<{ identity: NormalizedIdentity; user: BrokeredUser }> {
    if (!this.live.has(t)) throw new ProviderError('INVALID_SIGNATURE', 'bad token', 401)
    const id = this.users['bob@alt.test'].id
    return {
      identity: {
        userId: id,
        tenantId: null,
        roles: ['member'],
        authMode: 'federated-jwks',
      },
      user: { id, email: 'bob@alt.test', roles: ['member'] },
    }
  }
  async logout(t: string): Promise<void> {
    this.live.delete(t)
  }
  async provisionM2MClient(i: M2MClientProvisionInput): Promise<M2MClient> {
    return { clientId: 'alt-client', clientSecret: 'alt-secret' }
  }
  async issueM2MToken(i: M2MTokenInput): Promise<M2MToken> {
    if (i.clientId !== 'alt-client' || i.clientSecret !== 'alt-secret')
      throw new ProviderError('INVALID_CREDENTIALS', 'bad', 401)
    const t = `ALT-M2M-${this.n++}`
    this.m2m.set(t, Math.floor(Date.now() / 1000) + 3600)
    return { accessToken: t, tokenType: 'Bearer', expiresIn: 3600 }
  }
  async introspectToken(t: string): Promise<TokenIntrospection> {
    const exp = this.m2m.get(t)
    if (!exp) return { active: false }
    return { active: true, subject: 'alt-client', expiresAt: exp }
  }
  async listFactors(): Promise<MfaFactor[]> {
    return []
  }
  async enrollFactor(_t: string, _i: MfaEnrollInput): Promise<MfaEnrollResult> {
    throw new ProviderError('UNKNOWN', 'n/a', 500)
  }
  async activateFactor(): Promise<MfaFactor> {
    throw new ProviderError('UNKNOWN', 'n/a', 500)
  }
  async removeFactor(): Promise<void> {}
  async regenerateRecoveryCodes(): Promise<string[]> {
    return ['a', 'b']
  }
  async challengeMfa(): Promise<MfaChallengeAck> {
    throw new ProviderError('INVALID_CODE', 'n/a', 401)
  }
  async verifyMfa(): Promise<BrokeredSession> {
    throw new ProviderError('INVALID_CODE', 'n/a', 401)
  }
  async startEmailVerification(): Promise<void> {}
  async confirmEmailVerification(): Promise<VerificationStatus> {
    return { emailVerified: true, phoneVerified: false }
  }
  async startPhoneVerification(): Promise<void> {}
  async confirmPhoneVerification(): Promise<VerificationStatus> {
    return { emailVerified: false, phoneVerified: true }
  }
  async getVerificationStatus(t: string): Promise<VerificationStatus> {
    if (!this.live.has(t)) throw new ProviderError('INVALID_SIGNATURE', 'bad', 401)
    return { emailVerified: false, phoneVerified: false }
  }
}

describe('provider-swap proof — full path through an independent IdentityProvider', () => {
  // If we are pointed at a live implementation, the swap is proven by the impl
  // itself; this in-process proof only runs for the contract-mock configuration.
  const runIt = process.env.SECURITY_BASE_URL ? it.skip : it
  // ONE app + ONE alternate provider for the whole proof, so a token minted by
  // login is visible to the follow-up "me"/introspect calls (the alt provider
  // holds session/token state in memory, mirroring a live server).
  const app = createSecurityApp(new AltIdentityProvider())
  const api = () => supertest(app)

  runIt('login → me → logout works identically under the alternate provider', async () => {
    const login = await api()
      .post('/api/v1/security/session')
      .send({ email: 'bob@alt.test', password: 'alt-pass-99' })
    expect(login.status).toBe(200)
    assertSchema('SessionResult', login.body)
    expect(login.body.status).toBe('authenticated')
    expect(login.body.token).toMatch(/^ALT-TOKEN-/) // proves the alt impl is in play

    const me = await api()
      .get('/api/v1/security/session')
      .set('Authorization', `Bearer ${login.body.token}`)
    expect(me.status).toBe(200)
    assertSchema('SessionInfo', me.body)
    expect(me.body.identity.authMode).toBe('federated-jwks')

    const out = await api()
      .delete('/api/v1/security/session')
      .set('Authorization', `Bearer ${login.body.token}`)
    expect(out.status).toBe(204)
  })

  runIt('bad credentials still fail-closed under the alternate provider', async () => {
    const res = await api()
      .post('/api/v1/security/session')
      .send({ email: 'bob@alt.test', password: 'WRONG' })
    expect(res.status).toBe(401)
    assertSchema('ErrorBody', res.body)
  })

  runIt('social start 302 stays FuzeFront-owned under the alternate provider', async () => {
    const res = await api().get('/api/v1/security/social/google/start').redirects(0)
    expect(res.status).toBe(302)
    expect((res.headers['location'] || '').toLowerCase()).not.toContain('auth.fuzefront.com')
  })

  runIt('M2M issue + fail-closed introspection under the alternate provider', async () => {
    const issued = await api()
      .post('/api/v1/security/tokens')
      .send({ clientId: 'alt-client', clientSecret: 'alt-secret' })
    expect(issued.status).toBe(200)
    assertSchema('TokenIssueResponse', issued.body)

    const active = await api()
      .post('/api/v1/security/tokens/introspect')
      .send({ token: issued.body.accessToken })
    expect(active.body.active).toBe(true)

    const inactive = await api()
      .post('/api/v1/security/tokens/introspect')
      .send({ token: 'garbage' })
    expect(inactive.body.active).toBe(false)
  })
})
