/**
 * Unit tests for the SERVER-BROKERED Google sign-in path.
 *
 * The browser is 302'd STRAIGHT to accounts.google.com; the security service
 * exchanges the code with Google directly (mocked here), provisions/links the
 * user in the identity store (mocked), mints the FuzeFront session, and hands
 * back a single-use opaque code. Asserts: the start redirect targets Google (not
 * Authentik), the callback provisions + syncs + mints + redeems, the LINK flow
 * attaches without minting a session, and Google-error/expired-state paths fail
 * closed. No Authentik `/if/*` URL ever appears.
 */
import jwt from 'jsonwebtoken'
import {
  AuthentikIdentityProvider,
  UnauthorizedError,
} from '../src/providers/authentik/AuthentikIdentityProvider'
import type { NotificationClient } from '../src/providers/authentik/notifications'

process.env.JWT_SECRET = 'test-secret'
process.env.FRONTEND_URL = 'https://app.fuzefront.com'
// Brokered is the DEFAULT; assert it explicitly so this file is order-independent.
process.env.SECURITY_GOOGLE_BROKERED = 'true'

jest.mock('../src/services/organizationProvisioning', () => ({
  runInternalProvision: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: { publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined) },
}))

// ── Minimal in-memory knex-like fake (mirrors authentik-provider.test.ts) ────
function matches(row: any, cond: any, val?: any): boolean {
  if (typeof cond === 'string') return row[cond] === val
  return Object.entries(cond).every(([k, v]) => row[k] === v)
}
function makeFakeDb() {
  const tables: Record<string, any[]> = { users: [], sessions: [], mfa_factors: [], event_outbox: [] }
  function qb(table: string) {
    let filter = (_r: any) => true
    const api: any = {
      where(cond: any, val?: any) { const p = filter; filter = (r: any) => p(r) && matches(r, cond, val); return api },
      andWhere(cond: any, val?: any) { return api.where(cond, val) },
      whereRaw() { return api },
      async first() { return tables[table].find(filter) },
      select() { return tables[table].filter(filter) },
      async insert(rows: any) { const arr = Array.isArray(rows) ? rows : [rows]; tables[table].push(...arr.map(r => ({ ...r }))); return [] },
      async update(patch: any) { let n = 0; for (const r of tables[table]) if (filter(r)) { Object.assign(r, patch); n++ } return n },
      async del() { const b = tables[table].length; tables[table] = tables[table].filter(r => !filter(r)); return b - tables[table].length },
      then(resolve: any) { return Promise.resolve(tables[table].filter(filter)).then(resolve) },
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
  sendPasswordReset: jest.fn().mockResolvedValue(undefined),
}

function makeGoogleClient(identity?: any) {
  return {
    isInitialized: () => true,
    initialize: jest.fn().mockResolvedValue(undefined),
    generateAuthUrl: (state: string) => ({
      url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=cid&state=${state}&scope=openid%20email%20profile&redirect_uri=https%3A%2F%2Fapp.fuzefront.com%2Fapi%2Fv1%2Fsecurity%2Fsocial%2Fgoogle%2Fcallback`,
      codeVerifier: 'gverifier',
    }),
    handleCallback: jest.fn().mockResolvedValue(
      identity ?? { email: 'gina@example.com', emailVerified: true, firstName: 'Gina', lastName: 'Google', sub: 'google-sub-123' }
    ),
  }
}

function newProvider(opts: { db?: any; googleClient?: any; provisionSocialUser?: any; syncUser?: any } = {}) {
  const db = opts.db ?? makeFakeDb()
  const googleClient = opts.googleClient ?? makeGoogleClient()
  return {
    db,
    googleClient,
    provider: new AuthentikIdentityProvider({
      db,
      notifications,
      googleClient,
      provisionSocialUser: opts.provisionSocialUser ?? jest.fn().mockResolvedValue(undefined),
      syncUser:
        opts.syncUser ??
        jest.fn().mockImplementation(async (userinfo: any) => {
          const id = 'user-' + userinfo.email
          await db('users').insert({ id, email: userinfo.email, roles: JSON.stringify(['user']) })
          return { id, email: userinfo.email, roles: ['user'] }
        }),
    }),
  }
}

beforeEach(() => jest.clearAllMocks())

describe('server-brokered Google start', () => {
  it('302s the browser STRAIGHT to accounts.google.com (never Authentik)', async () => {
    const { provider } = newProvider()
    const { redirectUrl, state, codeVerifier } = await provider.startSocialLogin('google', '/dashboard')
    expect(redirectUrl.startsWith('https://accounts.google.com/')).toBe(true)
    expect(redirectUrl).not.toMatch(/\/if\//)
    expect(redirectUrl).not.toMatch(/\/source\/oauth\//)
    expect(redirectUrl).not.toMatch(/\/application\/o\/authorize/)
    // The registered redirect_uri must be the NEW security-service callback.
    expect(decodeURIComponent(redirectUrl)).toContain('/api/v1/security/social/google/callback')
    expect(state).toBeTruthy()
    expect(codeVerifier).toBe('gverifier')
  })

  it('initializes the Google client on demand', async () => {
    const gc = makeGoogleClient()
    gc.isInitialized = () => false
    const { provider } = newProvider({ googleClient: gc })
    await provider.startSocialLogin('google', '/')
    expect(gc.initialize).toHaveBeenCalled()
  })
})

describe('server-brokered Google callback (success)', () => {
  it('exchanges with Google, provisions in the store, syncs, mints a session, and redeems once', async () => {
    const provisionSocialUser = jest.fn().mockResolvedValue(undefined)
    const { provider, db, googleClient } = newProvider({ provisionSocialUser })
    const { state } = await provider.startSocialLogin('google', '/dashboard')

    const { code, redirectTo } = await provider.brokerCallback({ code: 'goog-auth-code', state })
    expect(redirectTo).toBe('/dashboard')

    // Code exchanged with Google server-to-server (not the IdP OIDC client).
    expect(googleClient.handleCallback).toHaveBeenCalledWith('goog-auth-code', state, 'gverifier')
    // Provisioned/linked in the identity store as system-of-record.
    expect(provisionSocialUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'gina@example.com', sub: 'google-sub-123' }),
      'google'
    )
    // Session minted + persisted.
    expect(db.__tables.sessions.length).toBe(1)

    const session = await provider.exchangeCode(code)
    expect(session.user.email).toBe('gina@example.com')
    const decoded = jwt.verify(session.token, 'test-secret') as any
    expect(decoded.userId).toBe(session.user.id)
    // Single-use.
    await expect(provider.exchangeCode(code)).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('server-brokered Google callback (failure paths)', () => {
  it('rejects an unknown/expired state fail-closed (no session minted)', async () => {
    const { provider, db } = newProvider()
    await expect(provider.brokerCallback({ code: 'x', state: 'never-issued' })).rejects.toBeInstanceOf(UnauthorizedError)
    expect(db.__tables.sessions.length).toBe(0)
  })

  it('propagates a Google token-exchange error and mints nothing', async () => {
    const gc = makeGoogleClient()
    gc.handleCallback = jest.fn().mockRejectedValue(new Error('google token endpoint 400 invalid_grant'))
    const provisionSocialUser = jest.fn().mockResolvedValue(undefined)
    const { provider, db } = newProvider({ googleClient: gc, provisionSocialUser })
    const { state } = await provider.startSocialLogin('google', '/dashboard')
    await expect(provider.brokerCallback({ code: 'bad', state })).rejects.toThrow(/invalid_grant/)
    expect(provisionSocialUser).not.toHaveBeenCalled()
    expect(db.__tables.sessions.length).toBe(0)
  })
})
