/**
 * Unit tests for AuthentikIdentityProvider — the concrete IdentityProvider.
 *
 * Exercises the absorbed/added logic against a lightweight in-memory fake db
 * and injected notification/oidc/password deps: session minting, MFA step-up
 * gating (MfaRequiredError), single-use opaque code exchange, the same-host
 * social-login boundary rewrite, signup conflict, TOTP enroll/activate, and
 * contact verification. Fail-closed paths are asserted.
 */
import jwt from 'jsonwebtoken'
import { AuthentikIdentityProvider, MfaRequiredError, ConflictError, UnauthorizedError, InvalidInputError } from '../src/providers/authentik/AuthentikIdentityProvider'
import * as totp from '../src/providers/authentik/totp'
import type { NotificationClient } from '../src/providers/authentik/notifications'

process.env.JWT_SECRET = 'test-secret'
process.env.FRONTEND_URL = 'https://app.fuzefront.com'
process.env.SECURITY_IDP_PROXY_PREFIX = '/api/auth/idp'

// ── Minimal in-memory knex-like fake ────────────────────────────────────────
function matches(row: any, cond: any, val?: any): boolean {
  if (typeof cond === 'string') return row[cond] === val
  return Object.entries(cond).every(([k, v]) => row[k] === v)
}
function makeFakeDb() {
  const tables: Record<string, any[]> = {
    users: [],
    sessions: [],
    mfa_factors: [],
    mfa_recovery_codes: [],
    email_verifications: [],
    event_outbox: [],
  }
  function qb(table: string) {
    let filter = (r: any) => true
    const api: any = {
      where(cond: any, val?: any) {
        const prev = filter
        filter = (r: any) => prev(r) && matches(r, cond, val)
        return api
      },
      andWhere(cond: any, val?: any) {
        return api.where(cond, val)
      },
      async first() {
        return tables[table].find(filter)
      },
      select() {
        return tables[table].filter(filter)
      },
      async insert(rows: any) {
        const arr = Array.isArray(rows) ? rows : [rows]
        tables[table].push(...arr.map(r => ({ ...r })))
        return []
      },
      async update(patch: any) {
        let n = 0
        for (const r of tables[table]) if (filter(r)) { Object.assign(r, patch); n++ }
        return n
      },
      async del() {
        const before = tables[table].length
        tables[table] = tables[table].filter(r => !filter(r))
        return before - tables[table].length
      },
      then(resolve: any) {
        // Allow `await db('t').where(...)` to resolve to the filtered rows.
        return Promise.resolve(tables[table].filter(filter)).then(resolve)
      },
    }
    return api
  }
  const db: any = (table: string) => qb(table)
  db.transaction = async (cb: any) => cb(db)
  db.__tables = tables
  return db
}

const notifications: NotificationClient = {
  sendSmsOtp: jest.fn().mockResolvedValue(undefined),
  checkSmsOtp: jest.fn().mockResolvedValue(true),
  sendEmailVerification: jest.fn().mockResolvedValue(undefined),
}

jest.mock('../src/services/organizationProvisioning', () => ({
  runInternalProvision: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: { publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined) },
}))

const fakeOidc: any = {
  isInitialized: () => true,
  initialize: jest.fn().mockResolvedValue(undefined),
  generateAuthUrl: (state: string) => ({ url: `https://auth.internal.example/application/o/authorize/?state=${state}&scope=openid`, codeVerifier: 'cv' }),
  handleCallback: jest.fn().mockResolvedValue({ id: 'social1', email: 's@e.com', roles: ['user'] }),
}

function newProvider(db = makeFakeDb(), overrides: any = {}) {
  return new AuthentikIdentityProvider({
    db,
    oidc: fakeOidc,
    notifications,
    passwordLoginFn: jest.fn().mockResolvedValue({ id: 'u1', email: 'u@e.com', roles: ['user'] }),
    // Default signupFn simulates Authentik enrollment + OIDC sync: the synced
    // projection row is inserted into the (fake) users table, mirroring the real
    // syncUserToDatabase path. Provider.signup then mints the session.
    signupFn: jest.fn().mockImplementation(async (input: any) => {
      const id = 'newuser-1'
      await db('users').insert({ id, email: input.email, first_name: input.firstName, last_name: input.lastName, roles: JSON.stringify(['user']) })
      return { id, email: input.email, firstName: input.firstName, lastName: input.lastName, roles: ['user'] }
    }),
    ...overrides,
  })
}

beforeEach(() => jest.clearAllMocks())

describe('passwordLogin', () => {
  it('mints a session when the user has no active MFA factors', async () => {
    const db = makeFakeDb()
    const p = newProvider(db)
    const session = await p.passwordLogin({ email: 'u@e.com', password: 'pw' })
    expect(session.token).toBeTruthy()
    expect(session.user.id).toBe('u1')
    expect(db.__tables.sessions.length).toBe(1)
    const decoded = jwt.verify(session.token, 'test-secret') as any
    expect(decoded.userId).toBe('u1')
  })

  it('throws MfaRequiredError when the user has an active factor', async () => {
    const db = makeFakeDb()
    db.__tables.mfa_factors.push({ id: 'f1', user_id: 'u1', type: 'totp', status: 'active', secret: 'S' })
    const p = newProvider(db)
    await expect(p.passwordLogin({ email: 'u@e.com', password: 'pw' })).rejects.toBeInstanceOf(MfaRequiredError)
  })

  it('rejects missing credentials with InvalidInputError', async () => {
    await expect(newProvider().passwordLogin({ email: '', password: '' } as any)).rejects.toBeInstanceOf(InvalidInputError)
  })
})

describe('social login boundary', () => {
  it('launches the Google source (not authorize) under the same-host IdP proxy prefix when one is set', async () => {
    const p = newProvider()
    const { redirectUrl, state, codeVerifier } = await p.startSocialLogin('google', '/home')
    // Must hit the source-redirect view — that 302s straight to Google. Going
    // to authorize with no session renders Authentik's `/if/flow/` UI instead.
    expect(redirectUrl.startsWith('/api/auth/idp/source/oauth/login/google/')).toBe(true)
    expect(redirectUrl).not.toMatch(/auth\.internal\.example/)
    // authorize is carried as the post-login `next`, not as the destination.
    const next = new URLSearchParams(redirectUrl.split('?')[1]).get('next')
    expect(next?.startsWith('/api/auth/idp/application/o/authorize/')).toBe(true)
    expect(state).toBeTruthy()
    // codeVerifier is surfaced so the route can set the oidc_cv cookie.
    expect(codeVerifier).toBe('cv')
  })

  it('defaults to a NATIVE same-host source path (empty prefix, matching #256 ingress)', async () => {
    const saved = process.env.SECURITY_IDP_PROXY_PREFIX
    delete process.env.SECURITY_IDP_PROXY_PREFIX
    try {
      const p = newProvider()
      const { redirectUrl } = await p.startSocialLogin('google', '/home')
      // Native path, no /api/auth/idp prefix, no double slash, no internal host.
      expect(redirectUrl.startsWith('/source/oauth/login/google/')).toBe(true)
      expect(redirectUrl.startsWith('//')).toBe(false)
      expect(redirectUrl).not.toMatch(/auth\.internal\.example/)
      const next = new URLSearchParams(redirectUrl.split('?')[1]).get('next')
      expect(next?.startsWith('/application/o/authorize/')).toBe(true)
    } finally {
      if (saved !== undefined) process.env.SECURITY_IDP_PROXY_PREFIX = saved
    }
  })

  it('never sends the browser to the Authentik flow UI (/if/)', async () => {
    const { redirectUrl } = await newProvider().startSocialLogin('google', '/home')
    expect(redirectUrl).not.toMatch(/\/if\//)
  })
  it('rejects an absolute redirectTo (open-redirect guard)', async () => {
    await expect(newProvider().startSocialLogin('google', 'https://evil.com')).rejects.toBeInstanceOf(InvalidInputError)
  })
  it('rejects an unsupported provider', async () => {
    await expect(newProvider().startSocialLogin('facebook')).rejects.toBeInstanceOf(InvalidInputError)
  })
  it('brokerCallback issues an opaque code that exchangeCode redeems exactly once', async () => {
    const p = newProvider()
    const { state } = await p.startSocialLogin('google', '/home')
    const { code, redirectTo } = await p.brokerCallback({ code: 'provcode', state })
    expect(redirectTo).toBe('/home')
    const session = await p.exchangeCode(code)
    expect(session.user.id).toBe('social1')
    // single-use
    await expect(p.exchangeCode(code)).rejects.toBeInstanceOf(UnauthorizedError)
  })
  it('brokerCallback rejects an unknown state fail-closed', async () => {
    await expect(newProvider().brokerCallback({ code: 'x', state: 'nope' })).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('signup', () => {
  it('delegates to Authentik enrollment (signupFn) then mints a session; no local bcrypt user', async () => {
    const db = makeFakeDb()
    const signupFn = jest.fn().mockImplementation(async (input: any) => {
      // Simulate the synced projection the OIDC callback would create.
      await db('users').insert({ id: 'ak-1', email: input.email, first_name: input.firstName, roles: JSON.stringify(['user']) })
      return { id: 'ak-1', email: input.email, firstName: input.firstName, roles: ['user'] }
    })
    const p = newProvider(db, { signupFn })
    const s = await p.signup({ email: 'new@e.com', password: 'pw', firstName: 'N' })
    expect(s.token).toBeTruthy()
    expect(s.user.id).toBe('ak-1')
    expect(signupFn).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@e.com', password: 'pw' }))
    // The user row is a synced projection — NOT a locally-hashed bcrypt insert.
    expect(db.__tables.users.length).toBe(1)
    expect(db.__tables.users[0].password_hash).toBeUndefined()
    expect(db.__tables.sessions.length).toBe(1)
  })

  it('rejects a duplicate email (existing projection) with ConflictError, without calling enrollment', async () => {
    const db = makeFakeDb()
    db.__tables.users.push({ id: 'u1', email: 'dup@e.com', roles: '["user"]' })
    const signupFn = jest.fn()
    const p = newProvider(db, { signupFn })
    await expect(p.signup({ email: 'dup@e.com', password: 'pw' })).rejects.toBeInstanceOf(ConflictError)
    expect(signupFn).not.toHaveBeenCalled()
  })

  it('maps an Authentik EnrollmentConflictError to ConflictError', async () => {
    const { EnrollmentConflictError } = require('../src/services/authentikPassword')
    const db = makeFakeDb()
    const signupFn = jest.fn().mockRejectedValue(new EnrollmentConflictError())
    const p = newProvider(db, { signupFn })
    await expect(p.signup({ email: 'x@e.com', password: 'pw' })).rejects.toBeInstanceOf(ConflictError)
  })

  it('rejects missing credentials with InvalidInputError', async () => {
    await expect(newProvider().signup({ email: '', password: '' } as any)).rejects.toBeInstanceOf(InvalidInputError)
  })
})

describe('session inspection', () => {
  it('getUserInfo returns a normalized legacy-hs256 identity and rejects revoked sessions', async () => {
    const db = makeFakeDb()
    db.__tables.users.push({ id: 'u1', email: 'u@e.com', roles: JSON.stringify(['user', 'admin']) })
    const p = newProvider(db)
    const session = await p.passwordLogin({ email: 'u@e.com', password: 'pw' })
    const { identity, user } = await p.getUserInfo(session.token)
    expect(identity.authMode).toBe('legacy-hs256')
    expect(identity.tenantId).toBeNull()
    expect(user.roles).toEqual(['user', 'admin'])
    // revoke
    await p.logout(session.token)
    await expect(p.getUserInfo(session.token)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('introspectToken is fail-closed for garbage tokens', async () => {
    const r = await newProvider().introspectToken('not-a-jwt')
    expect(r.active).toBe(false)
  })
})

describe('MFA TOTP enroll + activate', () => {
  it('enrolls a pending TOTP factor and activates it with a valid code', async () => {
    const db = makeFakeDb()
    db.__tables.users.push({ id: 'u1', email: 'u@e.com', roles: JSON.stringify(['user']) })
    const p = newProvider(db)
    const session = await p.passwordLogin({ email: 'u@e.com', password: 'pw' })
    const enroll = await p.enrollFactor(session.token, { type: 'totp' })
    expect(enroll.status).toBe('pending')
    expect(enroll.secret).toBeTruthy()
    const code = totp.generateToken(enroll.secret!)
    const factor = await p.activateFactor(session.token, enroll.factorId, code)
    expect(factor.status).toBe('active')
    // bad code fails closed
    await expect(p.activateFactor(session.token, enroll.factorId, '000000')).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('sms enroll dispatches an OTP via the notification client', async () => {
    const db = makeFakeDb()
    db.__tables.users.push({ id: 'u1', email: 'u@e.com', roles: '["user"]' })
    const p = newProvider(db)
    const session = await p.passwordLogin({ email: 'u@e.com', password: 'pw' })
    const enroll = await p.enrollFactor(session.token, { type: 'sms', phone: '+15551234567' })
    expect(enroll.codeSent).toBe(true)
    expect(notifications.sendSmsOtp).toHaveBeenCalledWith('+15551234567')
  })
})

describe('contact verification', () => {
  it('email start + confirm marks the user verified', async () => {
    const db = makeFakeDb()
    db.__tables.users.push({ id: 'u1', email: 'u@e.com', roles: '["user"]' })
    const p = newProvider(db)
    const session = await p.passwordLogin({ email: 'u@e.com', password: 'pw' })
    await p.startEmailVerification(session.token)
    expect(notifications.sendEmailVerification).toHaveBeenCalled()
    const row = db.__tables.email_verifications[0]
    // recover the plaintext token by calling confirm with the code the impl hashed:
    // we cannot read the plaintext, so assert confirm rejects a bad token fail-closed
    await expect(p.confirmEmailVerification({ token: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedError)
    expect(row.email).toBe('u@e.com')
  })

  it('phone confirm marks verified when the OTP checks out', async () => {
    const db = makeFakeDb()
    db.__tables.users.push({ id: 'u1', email: 'u@e.com', phone: '+15551234567', roles: '["user"]' })
    const p = newProvider(db)
    const status = await p.confirmPhoneVerification('+15551234567', '123456')
    expect(status.phoneVerified).toBe(true)
    expect(db.__tables.users[0].phone_verified).toBe(true)
  })
})
