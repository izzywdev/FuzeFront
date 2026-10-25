/**
 * MFA recovery-code redemption at sign-in (contract 1.3.0).
 *
 *  - provider tests against an in-memory knex-like fake (with a rollbacking
 *    transaction) for: normalization, single-use, concurrent double redeem,
 *    replaced set, failure-consumes-nothing, recoveryAvailable, status counts;
 *  - route tests against a fake IdentityProvider for the HTTP contract:
 *    body shapes (400), error codes (401), shared limiter (429), GET status.
 */
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import securityRouter, { resetMfaVerifyLimiter } from '../src/routes/security'
import { setIdentityProvider } from '../src/providers/factory'
import {
  AuthentikIdentityProvider,
  MfaRequiredError,
  RecoveryCodeInvalidError,
  UnauthorizedError,
  normalizeRecoveryCode,
} from '../src/providers/authentik/AuthentikIdentityProvider'
import type { IdentityProvider, BrokeredSession } from '../src/providers/IdentityProvider'

const SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret'
process.env.JWT_SECRET = SECRET

jest.mock('../src/services/organizationProvisioning', () => ({
  runInternalProvision: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: { publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined) },
}))

const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex')

// ── in-memory knex-like fake: insert/update/select + snapshot-rollback trx ──
function matches(row: any, cond: any, val?: any): boolean {
  if (typeof cond === 'string') return row[cond] === val
  return Object.entries(cond).every(([k, v]) => row[k] === v)
}
function makeFakeDb() {
  const tables: Record<string, any[]> = {
    users: [], sessions: [], mfa_factors: [], mfa_recovery_codes: [],
  }
  function qb(table: string) {
    let filter = (_r: any) => true
    const api: any = {
      where(cond: any, val?: any) {
        const prev = filter
        filter = (r: any) => prev(r) && matches(r, cond, val)
        return api
      },
      async first() {
        await Promise.resolve()
        return tables[table].find(filter)
      },
      select() {
        return Promise.resolve(tables[table].filter(filter))
      },
      async insert(row: any) {
        await Promise.resolve()
        tables[table].push(...(Array.isArray(row) ? row : [row]))
        return [1]
      },
      async update(patch: any) {
        await Promise.resolve() // yield: lets concurrent callers interleave
        let n = 0
        for (const r of tables[table]) if (filter(r)) { Object.assign(r, patch); n++ }
        return n
      },
      async del() {
        const before = tables[table].length
        tables[table] = tables[table].filter(r => !filter(r))
        return before - tables[table].length
      },
      then(resolve: any, reject: any) {
        return Promise.resolve(tables[table].filter(filter)).then(resolve, reject)
      },
    }
    return api
  }
  const db: any = (table: string) => qb(table)
  // Serialised (like a row lock) so a loser's snapshot-rollback cannot clobber
  // a winner's committed write; the atomic guard under test is the rowcount check.
  let lock: Promise<void> = Promise.resolve()
  db.transaction = async (fn: (trx: any) => Promise<any>) => {
    const prev = lock
    let release!: () => void
    lock = new Promise<void>(r => (release = r))
    await prev
    const snap = JSON.stringify(tables)
    try {
      return await fn(db)
    } catch (e) {
      const restored = JSON.parse(snap)
      for (const k of Object.keys(tables)) tables[k] = restored[k]
      throw e
    } finally {
      release()
    }
  }
  db.__tables = tables
  return db
}

const CODES = ['a1b2c3d4e5', 'f6a7b8c9d0', '0123456789']

function setup(codes: string[] = CODES) {
  const db = makeFakeDb()
  db.__tables.users.push({
    id: 'u1', email: 'u@e.com', first_name: 'U', last_name: 'E', roles: JSON.stringify(['user']), has_password: true,
  })
  db.__tables.mfa_factors.push({ id: 'f1', user_id: 'u1', type: 'totp', status: 'active' })
  codes.forEach((c, i) =>
    db.__tables.mfa_recovery_codes.push({ id: `r${i}`, user_id: 'u1', code_hash: sha(c), used: false })
  )
  const provider = new AuthentikIdentityProvider({
    db,
    passwordLoginFn: jest.fn().mockResolvedValue({ id: 'u1', email: 'u@e.com', roles: [] }),
    now: () => Date.now(),
  } as any)
  const token = jwt.sign({ userId: 'u1', sessionId: 's-cur' }, SECRET, { algorithm: 'HS256' })
  db.__tables.sessions.push({ id: 's-cur', user_id: 'u1' })
  return { db, provider, token }
}

async function openChallenge(provider: AuthentikIdentityProvider): Promise<MfaRequiredError> {
  try {
    await provider.passwordLogin({ email: 'u@e.com', password: 'pw' })
  } catch (e) {
    if (e instanceof MfaRequiredError) return e
    throw e
  }
  throw new Error('expected MfaRequiredError')
}

describe('normalizeRecoveryCode', () => {
  it('trims, strips spaces and hyphens, case-folds', () => {
    expect(normalizeRecoveryCode('  A1B2C-3D4E5 ')).toBe('a1b2c3d4e5')
    expect(normalizeRecoveryCode('a1b2 c3d4-e5')).toBe('a1b2c3d4e5')
  })
})

describe('provider: verifyMfaRecovery', () => {
  it('redeems a valid code, returns a session, and burns exactly that code', async () => {
    const { db, provider } = setup()
    const ch = await openChallenge(provider)
    const s = await provider.verifyMfaRecovery(ch.challengeId, CODES[0])
    expect(s.token).toBeTruthy()
    expect(db.__tables.mfa_recovery_codes.filter((r: any) => r.used)).toHaveLength(1)
    expect(db.__tables.mfa_recovery_codes[0].used).toBe(true)
  })

  it('accepts the code typed as displayed (upper case, spaces, hyphens)', async () => {
    const { provider } = setup()
    const ch = await openChallenge(provider)
    await expect(provider.verifyMfaRecovery(ch.challengeId, ' A1B2C-3D4E5 ')).resolves.toBeTruthy()
  })

  it('needs no prior challengeMfa call', async () => {
    const { provider } = setup()
    const ch = await openChallenge(provider)
    // straight to redeem — no challengeMfa
    await expect(provider.verifyMfaRecovery(ch.challengeId, CODES[1])).resolves.toBeTruthy()
  })

  it('a wrong code throws RECOVERY_CODE_INVALID, consumes nothing, and the challenge stays usable', async () => {
    const { db, provider } = setup()
    const ch = await openChallenge(provider)
    await expect(provider.verifyMfaRecovery(ch.challengeId, 'deadbeef00')).rejects.toBeInstanceOf(RecoveryCodeInvalidError)
    expect(db.__tables.mfa_recovery_codes.every((r: any) => !r.used)).toBe(true)
    await expect(provider.verifyMfaRecovery(ch.challengeId, CODES[0])).resolves.toBeTruthy()
  })

  it('empty-after-normalization input is invalid, not a crash', async () => {
    const { provider } = setup()
    const ch = await openChallenge(provider)
    await expect(provider.verifyMfaRecovery(ch.challengeId, ' - - ')).rejects.toBeInstanceOf(RecoveryCodeInvalidError)
  })

  it('a used code cannot be redeemed again (second challenge)', async () => {
    const { provider } = setup()
    const c1 = await openChallenge(provider)
    await provider.verifyMfaRecovery(c1.challengeId, CODES[0])
    const c2 = await openChallenge(provider)
    await expect(provider.verifyMfaRecovery(c2.challengeId, CODES[0])).rejects.toBeInstanceOf(RecoveryCodeInvalidError)
  })

  it('the challenge is consumed on success (replay -> NOT_ACTIVE path)', async () => {
    const { provider } = setup()
    const ch = await openChallenge(provider)
    await provider.verifyMfaRecovery(ch.challengeId, CODES[0])
    await expect(provider.verifyMfaRecovery(ch.challengeId, CODES[1])).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('unknown challenge -> UnauthorizedError (NOT_ACTIVE), not RECOVERY_CODE_INVALID', async () => {
    const { provider } = setup()
    await expect(provider.verifyMfaRecovery('nope', CODES[0])).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('expired challenge -> UnauthorizedError and consumes nothing', async () => {
    const db = makeFakeDb()
    let t = 1_000_000
    db.__tables.users.push({ id: 'u1', email: 'u@e.com', first_name: 'U', last_name: 'E', roles: '["user"]' })
    db.__tables.mfa_factors.push({ id: 'f1', user_id: 'u1', type: 'totp', status: 'active' })
    db.__tables.mfa_recovery_codes.push({ id: 'r0', user_id: 'u1', code_hash: sha(CODES[0]), used: false })
    const provider = new AuthentikIdentityProvider({
      db, passwordLoginFn: jest.fn().mockResolvedValue({ id: 'u1', email: 'u@e.com', roles: [] }), now: () => t,
    } as any)
    const ch = await openChallenge(provider)
    t += 60 * 60_000
    await expect(provider.verifyMfaRecovery(ch.challengeId, CODES[0])).rejects.toBeInstanceOf(UnauthorizedError)
    expect(db.__tables.mfa_recovery_codes[0].used).toBe(false)
  })

  it('a code from a REPLACED set is rejected (indistinguishable from wrong)', async () => {
    const { db, provider, token } = setup()
    const newCodes = await provider.regenerateRecoveryCodes(token)
    expect(db.__tables.mfa_recovery_codes).toHaveLength(10)
    const ch = await openChallenge(provider)
    await expect(provider.verifyMfaRecovery(ch.challengeId, CODES[0])).rejects.toBeInstanceOf(RecoveryCodeInvalidError)
    await expect(provider.verifyMfaRecovery(ch.challengeId, newCodes[0])).resolves.toBeTruthy()
  })

  it('concurrent double redeem of the SAME code on two challenges succeeds at most once', async () => {
    const { db, provider } = setup()
    const a = await openChallenge(provider)
    const b = await openChallenge(provider)
    const results = await Promise.allSettled([
      provider.verifyMfaRecovery(a.challengeId, CODES[0]),
      provider.verifyMfaRecovery(b.challengeId, CODES[0]),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(RecoveryCodeInvalidError)
    expect(db.__tables.mfa_recovery_codes.filter((r: any) => r.used)).toHaveLength(1)
  })

  it('concurrent redeem of two DIFFERENT codes on ONE challenge completes it at most once', async () => {
    const { db, provider } = setup()
    const ch = await openChallenge(provider)
    const results = await Promise.allSettled([
      provider.verifyMfaRecovery(ch.challengeId, CODES[0]),
      provider.verifyMfaRecovery(ch.challengeId, CODES[1]),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(db.__tables.mfa_recovery_codes.filter((r: any) => r.used)).toHaveLength(1)
    expect(db.__tables.sessions.filter((s: any) => s.id !== 's-cur')).toHaveLength(1)
  })

  it('rolls the burn back if session minting fails after the code was consumed', async () => {
    const { db, provider } = setup()
    const ch = await openChallenge(provider)
    const orig = db.__tables.sessions.push.bind(db.__tables.sessions)
    db.__tables.sessions.push = () => { throw new Error('db down') }
    await expect(provider.verifyMfaRecovery(ch.challengeId, CODES[0])).rejects.toThrow('db down')
    db.__tables.sessions.push = orig
    expect(db.__tables.mfa_recovery_codes.every((r: any) => !r.used)).toBe(true)
    await expect(provider.verifyMfaRecovery(ch.challengeId, CODES[0])).resolves.toBeTruthy()
  })
})

describe('provider: recoveryAvailable + status', () => {
  it('recoveryAvailable is true with >=1 unused code', async () => {
    const { provider } = setup()
    expect((await openChallenge(provider)).recoveryAvailable).toBe(true)
  })
  it('recoveryAvailable is false with no codes, or when all are used', async () => {
    const none = setup([])
    expect((await openChallenge(none.provider)).recoveryAvailable).toBe(false)
    const used = setup([CODES[0]])
    used.db.__tables.mfa_recovery_codes[0].used = true
    expect((await openChallenge(used.provider)).recoveryAvailable).toBe(false)
  })
  it('recoveryAvailable fails safe to false if the lookup throws', async () => {
    const { db, provider } = setup()
    const orig = db.__tables
    Object.defineProperty(db.__tables, 'mfa_recovery_codes', { get() { throw new Error('boom') }, configurable: true })
    const ch = await openChallenge(provider)
    expect(ch.recoveryAvailable).toBe(false)
    Object.defineProperty(orig, 'mfa_recovery_codes', { value: [], writable: true, configurable: true })
  })
  it('status counts remaining/total, drops after a redeem, resets on regenerate; never returns codes', async () => {
    const { provider, token } = setup()
    expect(await provider.getRecoveryCodesStatus(token)).toEqual({ remaining: 3, total: 3 })
    const ch = await openChallenge(provider)
    await provider.verifyMfaRecovery(ch.challengeId, CODES[0])
    expect(await provider.getRecoveryCodesStatus(token)).toEqual({ remaining: 2, total: 3 })
    await provider.regenerateRecoveryCodes(token)
    expect(await provider.getRecoveryCodesStatus(token)).toEqual({ remaining: 10, total: 10 })
  })
  it('status is {0,0} for a user who never generated codes', async () => {
    const { provider, token } = setup([])
    expect(await provider.getRecoveryCodesStatus(token)).toEqual({ remaining: 0, total: 0 })
  })
})

// ── routes ──────────────────────────────────────────────────────────────────
const USER = { id: 'u1', email: 'u@e.com', firstName: 'U', lastName: 'E', roles: ['user'] }
const SESSION: BrokeredSession = { token: 'tok', sessionId: 'sess', user: USER }

function routeProvider(o: Partial<IdentityProvider> = {}): IdentityProvider {
  return {
    verifyMfa: jest.fn().mockResolvedValue(SESSION),
    verifyMfaRecovery: jest.fn().mockResolvedValue(SESSION),
    getRecoveryCodesStatus: jest.fn().mockResolvedValue({ remaining: 4, total: 10 }),
    passwordLogin: jest.fn().mockRejectedValue(new MfaRequiredError('ch1', [{ factorId: 'f1', type: 'totp' }], true)),
    ...o,
  } as unknown as IdentityProvider
}
function makeApp(p: IdentityProvider) {
  setIdentityProvider(p)
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', securityRouter)
  return app
}
beforeEach(() => resetMfaVerifyLimiter())
afterEach(() => setIdentityProvider(null))

describe('route: POST /mfa/verify', () => {
  const post = (app: any, body: any) => request(app).post('/api/v1/security/mfa/verify').send(body)

  it('recovery shape -> 200 LoginResponse', async () => {
    const p = routeProvider()
    const res = await post(makeApp(p), { challengeId: 'ch1', recoveryCode: 'A1B2C-3D4E5' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBe('tok')
    expect(p.verifyMfaRecovery).toHaveBeenCalledWith('ch1', 'A1B2C-3D4E5', expect.anything())
    expect(p.verifyMfa).not.toHaveBeenCalled()
  })

  it('factor shape is unchanged -> 200', async () => {
    const p = routeProvider()
    const res = await post(makeApp(p), { challengeId: 'ch1', factorId: 'f1', code: '123456' })
    expect(res.status).toBe(200)
    expect(p.verifyMfa).toHaveBeenCalled()
  })

  it.each([
    ['both shapes', { challengeId: 'c', factorId: 'f', code: '1', recoveryCode: 'x' }],
    ['recovery + extra key', { challengeId: 'c', recoveryCode: 'x', foo: 1 }],
    ['recovery missing challengeId', { recoveryCode: 'x' }],
    ['empty recoveryCode', { challengeId: 'c', recoveryCode: '' }],
    ['over-long recoveryCode', { challengeId: 'c', recoveryCode: 'x'.repeat(65) }],
    ['non-string recoveryCode', { challengeId: 'c', recoveryCode: 123 }],
    ['neither shape', { challengeId: 'c' }],
    ['empty body', {}],
  ])('400 MALFORMED: %s', async (_n, body) => {
    const p = routeProvider()
    const res = await post(makeApp(p), body)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('MALFORMED')
    expect(p.verifyMfaRecovery).not.toHaveBeenCalled()
    expect(p.verifyMfa).not.toHaveBeenCalled()
  })

  it('401 NOT_ACTIVE for an unknown/expired/completed challenge', async () => {
    const p = routeProvider({ verifyMfaRecovery: jest.fn().mockRejectedValue(new UnauthorizedError('x')) })
    const res = await post(makeApp(p), { challengeId: 'gone', recoveryCode: 'abc' })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('NOT_ACTIVE')
  })

  it('401 RECOVERY_CODE_INVALID for a wrong/used/replaced code', async () => {
    const p = routeProvider({ verifyMfaRecovery: jest.fn().mockRejectedValue(new RecoveryCodeInvalidError()) })
    const res = await post(makeApp(p), { challengeId: 'ch1', recoveryCode: 'abc' })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('RECOVERY_CODE_INVALID')
  })

  it('429 RATE_LIMITED after repeated failures on one challenge; the same limiter spans both shapes', async () => {
    const p = routeProvider({
      verifyMfaRecovery: jest.fn().mockRejectedValue(new RecoveryCodeInvalidError()),
      verifyMfa: jest.fn().mockRejectedValue(new UnauthorizedError('invalid code')),
    })
    const app = makeApp(p)
    // 5 failures alternating shapes, same challenge
    for (let i = 0; i < 5; i++) {
      const body = i % 2
        ? { challengeId: 'chX', recoveryCode: 'bad' }
        : { challengeId: 'chX', factorId: 'f1', code: '000000' }
      expect((await post(app, body)).status).toBe(401)
    }
    const blockedRecovery = await post(app, { challengeId: 'chX', recoveryCode: 'bad' })
    expect(blockedRecovery.status).toBe(429)
    expect(blockedRecovery.body.code).toBe('RATE_LIMITED')
    const blockedFactor = await post(app, { challengeId: 'chX', factorId: 'f1', code: '000000' })
    expect(blockedFactor.status).toBe(429)
    // a different challenge from the same IP is still allowed (per-challenge key)
    expect((await post(app, { challengeId: 'chY', recoveryCode: 'bad' })).status).toBe(401)
    // blocked requests never reach the provider
    expect((p.verifyMfaRecovery as jest.Mock).mock.calls.filter(c => c[0] === 'chX')).toHaveLength(2)
  })

  it('per-IP cap applies across challenges', async () => {
    const p = routeProvider({ verifyMfaRecovery: jest.fn().mockRejectedValue(new RecoveryCodeInvalidError()) })
    const app = makeApp(p)
    for (let i = 0; i < 20; i++) {
      expect((await post(app, { challengeId: `c${i}`, recoveryCode: 'bad' })).status).toBe(401)
    }
    expect((await post(app, { challengeId: 'fresh', recoveryCode: 'bad' })).status).toBe(429)
  })

  it('successes are never counted against the limiter', async () => {
    const app = makeApp(routeProvider())
    for (let i = 0; i < 30; i++) {
      expect((await post(app, { challengeId: 'chZ', recoveryCode: 'ok' })).status).toBe(200)
    }
  })

  it('never echoes the submitted code in an error body', async () => {
    const p = routeProvider({ verifyMfaRecovery: jest.fn().mockRejectedValue(new RecoveryCodeInvalidError()) })
    const res = await post(makeApp(p), { challengeId: 'ch1', recoveryCode: 'SECRETCODE99' })
    expect(JSON.stringify(res.body)).not.toContain('SECRETCODE99')
  })
})

describe('route: login response + GET /mfa/recovery-codes', () => {
  it('mfa_required response carries recoveryAvailable (true and false)', async () => {
    const yes = await request(makeApp(routeProvider())).post('/api/v1/security/session').send({ email: 'a@b.c', password: 'x' })
    expect(yes.body).toEqual({ status: 'mfa_required', challengeId: 'ch1', factors: [{ factorId: 'f1', type: 'totp' }], recoveryAvailable: true })
    const no = await request(makeApp(routeProvider({
      passwordLogin: jest.fn().mockRejectedValue(new MfaRequiredError('ch2', [], false)),
    }))).post('/api/v1/security/session').send({ email: 'a@b.c', password: 'x' })
    expect(no.body.recoveryAvailable).toBe(false)
  })

  it('GET returns {remaining,total} only, with a bearer', async () => {
    const res = await request(makeApp(routeProvider())).get('/api/v1/security/mfa/recovery-codes').set('Authorization', 'Bearer t')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ remaining: 4, total: 10 })
  })

  it('GET is 401 without a bearer and does not hit the provider', async () => {
    const p = routeProvider()
    const res = await request(makeApp(p)).get('/api/v1/security/mfa/recovery-codes')
    expect(res.status).toBe(401)
    expect(p.getRecoveryCodesStatus).not.toHaveBeenCalled()
  })
})
