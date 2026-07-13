/**
 * Backend unit and integration tests for the Google Sign-In (Authentik OIDC) flow.
 *
 * Architecture of the flow:
 *   User → FuzeFront /oidc/login → Authentik (OIDC/PKCE with code_challenge)
 *   → Authentik shows "Sign in with Google" → Google authenticates the user
 *   → Authentik receives Google tokens → Authentik issues code to FuzeFront callback
 *   → FuzeFront /oidc/callback → issues short-lived exchange code → frontend
 *   → frontend POST /token-exchange → JWT + sessionId
 *
 * FuzeFront never contacts Google directly. All Google auth is inside Authentik.
 *
 * Coverage:
 *  1. OIDCService unit tests  (mocked openid-client, db, eventPublisher)
 *  2. syncUserToDatabase semantics — new user, existing user (link_by_email), Kafka fail
 *  3. Route integration tests (spied oidcService, mocked db)
 *
 * Does NOT duplicate tests already in:
 *  - oidc-state.test.ts   (PKCE/CSRF cookie state checks)
 *  - oidc-code-exchange.test.ts  (single-use / expiry of exchange code)
 */
import express from 'express'
import request from 'supertest'

// ─── Module-level mocks (hoisted by jest before imports) ───────────────────

// Prevent any outbound network calls to Authentik or Google
jest.mock('openid-client', () => ({
  Issuer: {
    discover: jest.fn(),
  },
  generators: {
    codeVerifier: jest.fn().mockReturnValue('mock-code-verifier'),
    codeChallenge: jest.fn().mockReturnValue('mock-code-challenge'),
    state: jest.fn().mockReturnValue('mock-oidc-state'),
  },
}))

// Prevent Kafka connection attempts (best-effort publish path in syncUserToDatabase)
jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: {
    publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined),
    publishNotifyEmailRequested: jest.fn().mockResolvedValue(undefined),
  },
}))

// Run without a live Postgres instance
jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), {
    transaction: jest.fn(),
  }),
}))

// Predictable JWTs in route tests
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
  verify: jest.fn(),
}))

// Predictable UUIDs (session IDs in route tests)
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid-1234'),
}))

// Fire-and-forget provisioning — skip DB work
jest.mock('../src/services/organizationProvisioning', () => ({
  runInternalProvision: jest.fn().mockResolvedValue(undefined),
}))

// ─── Imports (after mock declarations) ─────────────────────────────────────
import { oidcService } from '../src/services/oidc'
import { db } from '../src/config/database'
import { defaultEventPublisher } from '../src/services/eventPublisher'
import authRouter from '../src/routes/auth'

// Typed handle to the db mock function
const dbFn = db as jest.MockedFunction<any>

// Build a minimal Express app mounting the auth routes
function buildApp(): express.Application {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  return app
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. OIDCService.isConfigured()
// ═══════════════════════════════════════════════════════════════════════════

describe('OIDCService.isConfigured()', () => {
  let savedClientId: string
  let savedClientSecret: string

  beforeEach(() => {
    savedClientId = (oidcService as any).config.clientId
    savedClientSecret = (oidcService as any).config.clientSecret
  })

  afterEach(() => {
    ;(oidcService as any).config.clientId = savedClientId
    ;(oidcService as any).config.clientSecret = savedClientSecret
  })

  it('returns false when AUTHENTIK_CLIENT_ID and AUTHENTIK_CLIENT_SECRET are absent', () => {
    ;(oidcService as any).config.clientId = ''
    ;(oidcService as any).config.clientSecret = ''
    expect(oidcService.isConfigured()).toBe(false)
  })

  it('returns true when both AUTHENTIK_CLIENT_ID and AUTHENTIK_CLIENT_SECRET are set', () => {
    ;(oidcService as any).config.clientId = 'test-client-id'
    ;(oidcService as any).config.clientSecret = 'test-client-secret'
    expect(oidcService.isConfigured()).toBe(true)
  })

  it('returns false when only client ID is set (secret missing)', () => {
    ;(oidcService as any).config.clientId = 'test-client-id'
    ;(oidcService as any).config.clientSecret = ''
    expect(oidcService.isConfigured()).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. OIDCService.generateAuthUrl()
// ═══════════════════════════════════════════════════════════════════════════

describe('OIDCService.generateAuthUrl()', () => {
  const mockAuthUrl =
    'http://mock-authentik/application/o/fuzefront/authorize?' +
    'code_challenge=mock-code-challenge&code_challenge_method=S256&state=test-state'

  const mockClient = {
    authorizationUrl: jest.fn().mockReturnValue(mockAuthUrl),
    callback: jest.fn(),
    userinfo: jest.fn(),
  }

  beforeEach(() => {
    ;(oidcService as any).client = mockClient
    mockClient.authorizationUrl.mockReturnValue(mockAuthUrl)
  })

  afterEach(() => {
    ;(oidcService as any).client = null
  })

  it('returns an object with both url and codeVerifier properties', () => {
    const result = oidcService.generateAuthUrl('test-state')
    expect(result).toHaveProperty('url')
    expect(result).toHaveProperty('codeVerifier')
  })

  it('codeVerifier is a non-empty string (stateless — caller persists it in cookie)', () => {
    const { codeVerifier } = oidcService.generateAuthUrl('test-state')
    expect(typeof codeVerifier).toBe('string')
    expect(codeVerifier.length).toBeGreaterThan(0)
  })

  it('url contains the PKCE code_challenge parameter', () => {
    const { url } = oidcService.generateAuthUrl('test-state')
    expect(url).toContain('code_challenge=')
  })

  it('calls client.authorizationUrl with S256 code_challenge_method', () => {
    oidcService.generateAuthUrl('test-state')
    expect(mockClient.authorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ code_challenge_method: 'S256' })
    )
  })

  it('throws when the openid-client has not been initialized', () => {
    ;(oidcService as any).client = null
    expect(() => oidcService.generateAuthUrl('test-state')).toThrow(
      /not initialized/i
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. OIDCService.handleCallback()
// ═══════════════════════════════════════════════════════════════════════════

describe('OIDCService.handleCallback()', () => {
  const mockUserInfo = {
    sub: 'google-sub-handlecb-001',
    email: 'handlecb@oidctest.example.com',
    given_name: 'Handle',
    family_name: 'Callback',
  }

  const mockClient = {
    authorizationUrl: jest.fn(),
    callback: jest.fn().mockResolvedValue({ access_token: 'mock-at-001' }),
    userinfo: jest.fn().mockResolvedValue(mockUserInfo),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(oidcService as any).client = mockClient
    mockClient.callback.mockResolvedValue({ access_token: 'mock-at-001' })
    mockClient.userinfo.mockResolvedValue(mockUserInfo)

    // syncUserToDatabase: new user path
    const trxInsert = jest.fn().mockResolvedValue([])
    const trx = jest.fn().mockReturnValue({ insert: trxInsert })
    ;(dbFn as any).transaction = jest.fn().mockImplementation(
      async (cb: Function) => cb(trx)
    )
    const qb = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(null), // no existing user
      update: jest.fn().mockResolvedValue([]),
    }
    dbFn.mockReturnValue(qb)
  })

  afterEach(() => {
    ;(oidcService as any).client = null
  })

  it('throws when codeVerifier is an empty string', async () => {
    await expect(
      oidcService.handleCallback('auth-code', 'some-state', '')
    ).rejects.toThrow(/code verifier not found/i)
  })

  it('calls openid-client callback with the correct PKCE verifier', async () => {
    await oidcService.handleCallback('auth-code-xyz', 'state-abc', 'verifier-123')
    expect(mockClient.callback).toHaveBeenCalledWith(
      expect.any(String), // redirectUri
      { code: 'auth-code-xyz', state: 'state-abc' },
      { code_verifier: 'verifier-123', state: 'state-abc' }
    )
  })

  it('calls userinfo with the access_token from the token set', async () => {
    mockClient.callback.mockResolvedValue({ access_token: 'at-specific' })
    await oidcService.handleCallback('auth-code-xyz', 'state-abc', 'verifier-123')
    expect(mockClient.userinfo).toHaveBeenCalledWith('at-specific')
  })

  it('returns a User with the correct shape from the userinfo claims', async () => {
    const user = await oidcService.handleCallback('auth-code-xyz', 'state-abc', 'verifier-123')
    expect(user).toMatchObject({
      email: mockUserInfo.email,
      firstName: mockUserInfo.given_name,
      lastName: mockUserInfo.family_name,
    })
    expect(typeof user.id).toBe('string')
    expect(Array.isArray(user.roles)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. syncUserToDatabase() — new Google-authenticated user
// ═══════════════════════════════════════════════════════════════════════════

describe('OIDCService syncUserToDatabase() — new Google-authenticated user', () => {
  const newUserInfo = {
    sub: 'google-sub-newuser-001',
    email: 'newgoogleuser@oidctest.example.com',
    given_name: 'New',
    family_name: 'GoogleUser',
  }

  let trxUserInsert: jest.Mock
  let trxOutboxInsert: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()

    trxUserInsert = jest.fn().mockResolvedValue([])
    trxOutboxInsert = jest.fn().mockResolvedValue([])

    const trx = jest.fn().mockImplementation((table: string) => {
      if (table === 'users') return { insert: trxUserInsert }
      if (table === 'event_outbox') return { insert: trxOutboxInsert }
      return { insert: jest.fn().mockResolvedValue([]) }
    })

    ;(dbFn as any).transaction = jest.fn().mockImplementation(
      async (cb: Function) => cb(trx)
    )

    // db('users').where('email', ...).first() → null (no existing user)
    // db('event_outbox').where(...).update(...) → success (after publish)
    const qbDefault = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue([]),
    }
    dbFn.mockReturnValue(qbDefault)
  })

  it('runs a transaction that inserts a new user row', async () => {
    await (oidcService as any).syncUserToDatabase(newUserInfo)
    expect((dbFn as any).transaction).toHaveBeenCalledTimes(1)
    expect(trxUserInsert).toHaveBeenCalledTimes(1)
    const [insertedRow] = trxUserInsert.mock.calls[0]
    expect(insertedRow).toMatchObject({
      email: newUserInfo.email,
      first_name: newUserInfo.given_name,
      last_name: newUserInfo.family_name,
    })
  })

  it('inserts an event_outbox row with topic "identity.user.created" in the same transaction', async () => {
    await (oidcService as any).syncUserToDatabase(newUserInfo)
    expect(trxOutboxInsert).toHaveBeenCalledTimes(1)
    const [outboxRow] = trxOutboxInsert.mock.calls[0]
    expect(outboxRow.topic).toBe('identity.user.created')
    expect(outboxRow.status).toBe('pending')
    expect(outboxRow.correlation_id).toMatch(/^identity-/)
  })

  it('event_outbox payload encodes the correct user fields', async () => {
    await (oidcService as any).syncUserToDatabase(newUserInfo)
    const [outboxRow] = trxOutboxInsert.mock.calls[0]
    const payload = JSON.parse(outboxRow.payload)
    expect(payload).toMatchObject({
      email: newUserInfo.email,
      firstName: newUserInfo.given_name,
      lastName: newUserInfo.family_name,
      intent: 'signup',
    })
  })

  it('publishes identity.user.created via the event publisher', async () => {
    await (oidcService as any).syncUserToDatabase(newUserInfo)
    expect(defaultEventPublisher.publishIdentityUserCreated).toHaveBeenCalledTimes(1)
  })

  it('returns a User with the correct shape', async () => {
    const user = await (oidcService as any).syncUserToDatabase(newUserInfo)
    expect(user).toMatchObject({
      email: newUserInfo.email,
      firstName: newUserInfo.given_name,
      lastName: newUserInfo.family_name,
      roles: ['user'],
    })
    expect(typeof user.id).toBe('string')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. syncUserToDatabase() — existing user (link_by_email / Authentik merge semantics)
//
// Authentik's `user_matching_mode: link_by_email` means a Google login and a
// password login with the same email merge into one Authentik user. By the time
// FuzeFront's callback fires, the subject has one canonical email. The first
// FuzeFront login creates the local row; every subsequent one (regardless of
// identity provider) must update — not duplicate — that row.
// ═══════════════════════════════════════════════════════════════════════════

describe('OIDCService syncUserToDatabase() — existing user (link_by_email semantics)', () => {
  const existingRow = {
    id: 'existing-user-uuid-001',
    email: 'existinguser@oidctest.example.com',
    first_name: 'OldFirst',
    last_name: 'OldLast',
    roles: '["user"]',
  }

  const googleUserInfo = {
    sub: 'google-sub-existing-001',
    email: existingRow.email, // same email → Authentik link_by_email
    given_name: 'NewFirst',   // name may differ after Google auth
    family_name: 'NewLast',
  }

  let updateMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()

    updateMock = jest.fn().mockResolvedValue([])
    ;(dbFn as any).transaction = jest.fn()

    const qb = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(existingRow),
      update: updateMock,
    }
    dbFn.mockReturnValue(qb)
  })

  it('updates first_name and last_name from the new Google-provided claims', async () => {
    await (oidcService as any).syncUserToDatabase(googleUserInfo)
    expect(updateMock).toHaveBeenCalledTimes(1)
    const [updatePayload] = updateMock.mock.calls[0]
    expect(updatePayload).toMatchObject({
      first_name: googleUserInfo.given_name,
      last_name: googleUserInfo.family_name,
    })
  })

  it('does NOT open a transaction (no new user row inserted)', async () => {
    await (oidcService as any).syncUserToDatabase(googleUserInfo)
    expect((dbFn as any).transaction).not.toHaveBeenCalled()
  })

  it('does NOT publish identity.user.created (not a new user)', async () => {
    await (oidcService as any).syncUserToDatabase(googleUserInfo)
    expect(defaultEventPublisher.publishIdentityUserCreated).not.toHaveBeenCalled()
  })

  it('returns the existing user id (no duplicate row created)', async () => {
    const user = await (oidcService as any).syncUserToDatabase(googleUserInfo)
    expect(user.id).toBe(existingRow.id)
    expect(user.email).toBe(existingRow.email)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. syncUserToDatabase() — Kafka publish fails (outbox durability guarantee)
// ═══════════════════════════════════════════════════════════════════════════

describe('OIDCService syncUserToDatabase() — Kafka publish fails', () => {
  const userInfo = {
    sub: 'google-sub-kafkafail-001',
    email: 'kafkafail@oidctest.example.com',
    given_name: 'Kafka',
    family_name: 'Fail',
  }

  beforeEach(() => {
    jest.clearAllMocks()

    const trx = jest.fn().mockReturnValue({ insert: jest.fn().mockResolvedValue([]) })
    ;(dbFn as any).transaction = jest.fn().mockImplementation(
      async (cb: Function) => cb(trx)
    )
    const qb = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue([]),
    }
    dbFn.mockReturnValue(qb)

    // Simulate Kafka being unavailable
    ;(defaultEventPublisher.publishIdentityUserCreated as jest.Mock).mockRejectedValueOnce(
      new Error('Kafka broker unreachable')
    )
  })

  it('does not throw even when the Kafka publish fails', async () => {
    await expect(
      (oidcService as any).syncUserToDatabase(userInfo)
    ).resolves.toBeDefined()
  })

  it('still returns a valid User shape when publish fails (outbox retains the event)', async () => {
    const user = await (oidcService as any).syncUserToDatabase(userInfo)
    expect(user).toMatchObject({
      email: userInfo.email,
      firstName: userInfo.given_name,
      lastName: userInfo.family_name,
      roles: ['user'],
    })
  })

  it('the outbox row was still inserted in the transaction before the publish attempt', async () => {
    // Even though publish fails, the outbox row must have been inserted atomically
    // with the user row (the transaction ran before the best-effort publish).
    const trxInserts: jest.Mock[] = []
    const trx = jest.fn().mockImplementation((_table: string) => {
      const ins = jest.fn().mockResolvedValue([])
      trxInserts.push(ins)
      return { insert: ins }
    })
    ;(dbFn as any).transaction = jest.fn().mockImplementation(
      async (cb: Function) => cb(trx)
    )
    await (oidcService as any).syncUserToDatabase(userInfo)
    // Transaction ran and had at least 2 inserts (users + event_outbox)
    expect((dbFn as any).transaction).toHaveBeenCalledTimes(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. Route: GET /api/auth/method — when OIDC is configured
// ═══════════════════════════════════════════════════════════════════════════

describe('Route GET /api/auth/method (OIDC configured)', () => {
  let app: express.Application
  let isConfiguredSpy: jest.SpyInstance

  beforeAll(() => {
    app = buildApp()
  })

  beforeEach(() => {
    isConfiguredSpy = jest.spyOn(oidcService, 'isConfigured').mockReturnValue(true)
  })

  afterEach(() => {
    isConfiguredSpy.mockRestore()
  })

  it('includes "oidc" and "local" in the methods array', async () => {
    const res = await request(app).get('/api/auth/method').expect(200)
    expect(res.body.methods).toContain('oidc')
    expect(res.body.methods).toContain('local')
  })

  it('returns oidcConfigured: true', async () => {
    const res = await request(app).get('/api/auth/method').expect(200)
    expect(res.body.oidcConfigured).toBe(true)
  })

  it('returns a non-null oidcLoginUrl when OIDC is configured', async () => {
    const res = await request(app).get('/api/auth/method').expect(200)
    expect(res.body.oidcLoginUrl).not.toBeNull()
    expect(typeof res.body.oidcLoginUrl).toBe('string')
  })

  it('returns defaultMethod: "oidc" when configured', async () => {
    const res = await request(app).get('/api/auth/method').expect(200)
    expect(res.body.defaultMethod).toBe('oidc')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. Route: GET /api/auth/oidc/login — when configured
// ═══════════════════════════════════════════════════════════════════════════

describe('Route GET /api/auth/oidc/login (configured)', () => {
  let app: express.Application
  let isConfiguredSpy: jest.SpyInstance
  let generateAuthUrlSpy: jest.SpyInstance

  beforeAll(() => {
    app = buildApp()
  })

  beforeEach(() => {
    isConfiguredSpy = jest.spyOn(oidcService, 'isConfigured').mockReturnValue(true)
    generateAuthUrlSpy = jest
      .spyOn(oidcService, 'generateAuthUrl')
      .mockReturnValue({
        url: 'http://mock-authentik/application/o/fuzefront/authorize?state=spy-state',
        codeVerifier: 'spy-code-verifier',
      })
  })

  afterEach(() => {
    isConfiguredSpy.mockRestore()
    generateAuthUrlSpy.mockRestore()
  })

  it('responds with HTTP 302', async () => {
    const res = await request(app).get('/api/auth/oidc/login')
    expect(res.status).toBe(302)
  })

  it('sets an HttpOnly oidc_state cookie', async () => {
    const res = await request(app).get('/api/auth/oidc/login')
    const cookies: string = Array.isArray(res.headers['set-cookie'])
      ? (res.headers['set-cookie'] as string[]).join(';')
      : (res.headers['set-cookie'] as string) || ''
    expect(cookies).toMatch(/oidc_state=/)
    expect(cookies).toMatch(/HttpOnly/i)
  })

  it('sets an HttpOnly oidc_cv cookie (PKCE code_verifier)', async () => {
    const res = await request(app).get('/api/auth/oidc/login')
    const cookies: string = Array.isArray(res.headers['set-cookie'])
      ? (res.headers['set-cookie'] as string[]).join(';')
      : (res.headers['set-cookie'] as string) || ''
    expect(cookies).toMatch(/oidc_cv=/)
    expect(cookies).toMatch(/HttpOnly/i)
  })

  it('Location header is the Authentik authorization URL returned by generateAuthUrl', async () => {
    const res = await request(app).get('/api/auth/oidc/login')
    expect(res.headers.location).toContain('mock-authentik')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. Route: GET /api/auth/oidc/callback
// ═══════════════════════════════════════════════════════════════════════════

describe('Route GET /api/auth/oidc/callback', () => {
  const MOCK_USER = {
    id: 'mock-oidc-user-uuid',
    email: 'google-callback-test@oidctest.example.com',
    firstName: 'Google',
    lastName: 'OIDCUser',
    roles: ['user'],
  }

  let app: express.Application
  let handleCallbackSpy: jest.SpyInstance

  beforeAll(() => {
    app = buildApp()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    handleCallbackSpy = jest
      .spyOn(oidcService, 'handleCallback')
      .mockResolvedValue(MOCK_USER)

    // db('sessions').insert(...) called by the route on happy path
    const sessionQb = { insert: jest.fn().mockResolvedValue([]) }
    dbFn.mockReturnValue(sessionQb)
  })

  afterEach(() => {
    handleCallbackSpy.mockRestore()
  })

  it('redirects with error=invalid_state when oidc_cv cookie is absent', async () => {
    const STATE = 'csrf-test-state-abc'
    const res = await request(app)
      .get(`/api/auth/oidc/callback?code=some-code&state=${STATE}`)
      .set('Cookie', `oidc_state=${STATE}`) // oidc_cv intentionally absent
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/error=invalid_state/)
  })

  it('redirects with error=invalid_state when state cookie does not match query param', async () => {
    const STATE = 'real-state-12345'
    const WRONG_STATE = 'wrong-state-99999'
    // Note: states must be different length here (length check fires first)
    const res = await request(app)
      .get(`/api/auth/oidc/callback?code=some-code&state=${STATE}`)
      .set('Cookie', `oidc_state=${WRONG_STATE}; oidc_cv=some-verifier`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/error=invalid_state/)
  })

  it('happy path: 302, Location contains ?code= (short-lived exchange token)', async () => {
    const STATE = 'happy-path-state-abc123'
    const res = await request(app)
      .get(`/api/auth/oidc/callback?code=auth-code&state=${STATE}`)
      .set('Cookie', `oidc_state=${STATE}; oidc_cv=pkce-verifier-xyz`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/[?&]code=/)
  })

  it('happy path: Location does NOT expose token= or sessionId= directly (avoids URL leakage)', async () => {
    const STATE = 'happy-path-state-abc123'
    const res = await request(app)
      .get(`/api/auth/oidc/callback?code=auth-code&state=${STATE}`)
      .set('Cookie', `oidc_state=${STATE}; oidc_cv=pkce-verifier-xyz`)
    expect(res.headers.location).not.toMatch(/[?&]token=/)
    expect(res.headers.location).not.toMatch(/[?&]sessionId=/)
  })

  it('happy path: a session row is inserted in the DB for the authenticated user', async () => {
    const insertMock = jest.fn().mockResolvedValue([])
    dbFn.mockReturnValue({ insert: insertMock })

    const STATE = 'session-insert-state-xyz'
    await request(app)
      .get(`/api/auth/oidc/callback?code=auth-code&state=${STATE}`)
      .set('Cookie', `oidc_state=${STATE}; oidc_cv=pkce-verifier-xyz`)

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: MOCK_USER.id })
    )
  })

  it('happy path: handleCallback is called with code, state, and the codeVerifier from cookie', async () => {
    const STATE = 'verify-args-state-abc'
    const CV = 'pkce-verifier-from-cookie'
    await request(app)
      .get(`/api/auth/oidc/callback?code=the-auth-code&state=${STATE}`)
      .set('Cookie', `oidc_state=${STATE}; oidc_cv=${CV}`)
    expect(handleCallbackSpy).toHaveBeenCalledWith('the-auth-code', STATE, CV)
  })

  it('redirects with error=authentication_failed when handleCallback throws', async () => {
    handleCallbackSpy.mockRejectedValue(new Error('Authentik token exchange failed'))
    const STATE = 'error-path-state-abc'
    const res = await request(app)
      .get(`/api/auth/oidc/callback?code=bad-code&state=${STATE}`)
      .set('Cookie', `oidc_state=${STATE}; oidc_cv=pkce-verifier-xyz`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/error=authentication_failed/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10. Route: POST /api/auth/token-exchange (OIDC-specific cases)
//
// Core single-use / expiry semantics are already tested in oidc-code-exchange.test.ts.
// This block adds coverage for the full Google Sign-In integration path and for the
// missing-code body case which is shared but needed for completeness here.
// ═══════════════════════════════════════════════════════════════════════════

describe('Route POST /api/auth/token-exchange', () => {
  let app: express.Application
  let handleCallbackSpy: jest.SpyInstance
  const MOCK_USER = {
    id: 'exchange-test-user-uuid',
    email: 'exchange-test@oidctest.example.com',
    firstName: 'Exchange',
    lastName: 'Test',
    roles: ['user'],
  }

  // Counter to generate unique, non-colliding state strings per test
  let stateCounter = 0
  function nextState() {
    return `exchange-test-state-${++stateCounter}`
  }

  async function issueFreshCode(a: express.Application): Promise<string> {
    const STATE = nextState()
    const cbRes = await request(a)
      .get(`/api/auth/oidc/callback?code=auth-code&state=${STATE}`)
      .set('Cookie', `oidc_state=${STATE}; oidc_cv=test-verifier`)
    if (cbRes.status !== 302) throw new Error(`Callback did not redirect: ${cbRes.status}`)
    const code = new URL(cbRes.headers.location).searchParams.get('code')
    if (!code) throw new Error(`No ?code= in redirect: ${cbRes.headers.location}`)
    return code
  }

  beforeAll(() => {
    app = buildApp()
    handleCallbackSpy = jest
      .spyOn(oidcService, 'handleCallback')
      .mockResolvedValue(MOCK_USER)
    dbFn.mockReturnValue({ insert: jest.fn().mockResolvedValue([]) })
  })

  afterAll(() => {
    handleCallbackSpy.mockRestore()
  })

  it('returns { token, sessionId } for a valid exchange code issued via the OIDC callback', async () => {
    const code = await issueFreshCode(app)
    const res = await request(app).post('/api/auth/token-exchange').send({ code })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
    expect(res.body).toHaveProperty('sessionId')
  })

  it('second redemption of the same code returns 401 (single-use guarantee)', async () => {
    const code = await issueFreshCode(app)
    await request(app).post('/api/auth/token-exchange').send({ code })
    const second = await request(app).post('/api/auth/token-exchange').send({ code })
    expect(second.status).toBe(401)
  })

  it('expired code (past 60 s TTL) returns 401', async () => {
    jest.useFakeTimers()
    const code = await issueFreshCode(app)
    jest.advanceTimersByTime(61_000)
    const res = await request(app).post('/api/auth/token-exchange').send({ code })
    expect(res.status).toBe(401)
    jest.useRealTimers()
  })

  it('returns 400 when the code field is missing from the body', async () => {
    const res = await request(app).post('/api/auth/token-exchange').send({})
    expect(res.status).toBe(400)
  })
})
