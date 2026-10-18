/**
 * FFRNT-140 / FFRNT-141 — remove-last-factor guard + change-password.
 *
 * Two layers:
 *  - provider tests against an in-memory knex-like fake (transaction + row lock
 *    modelled) asserting the atomic LAST_FACTOR guard and changePassword logic;
 *  - route tests against a fake IdentityProvider asserting the HTTP contract
 *    (status + stable `code`, bearer enforcement, body strictness).
 */
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import securityRouter from '../src/routes/security'
import { setIdentityProvider } from '../src/providers/factory'
import {
  AuthentikIdentityProvider,
  LastFactorError,
  NoPasswordError,
  CurrentPasswordInvalidError,
  PasswordPolicyRejectedError,
  InvalidInputError,
  UnauthorizedError,
} from '../src/providers/authentik/AuthentikIdentityProvider'
import type { IdentityProvider } from '../src/providers/IdentityProvider'

const SECRET = 'test-secret'
process.env.JWT_SECRET = SECRET

jest.mock('../src/services/organizationProvisioning', () => ({
  runInternalProvision: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: { publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined) },
}))

// ── in-memory knex-like fake with transaction + forUpdate ───────────────────
function matches(row: any, cond: any, val?: any): boolean {
  if (typeof cond === 'string') return row[cond] === val
  return Object.entries(cond).every(([k, v]) => row[k] === v)
}
function makeFakeDb() {
  const tables: Record<string, any[]> = { users: [], sessions: [], mfa_factors: [] }
  let lock: Promise<void> = Promise.resolve()
  function qb(table: string) {
    let filter = (_r: any) => true
    const api: any = {
      where(cond: any, val?: any) {
        const prev = filter
        filter = (r: any) => prev(r) && matches(r, cond, val)
        return api
      },
      whereNot(cond: any) {
        const prev = filter
        filter = (r: any) => prev(r) && !matches(r, cond)
        return api
      },
      forUpdate() {
        return api
      },
      async first() {
        await Promise.resolve()
        return tables[table].find(filter)
      },
      select() {
        return Promise.resolve(tables[table].filter(filter))
      },
      async update(patch: any) {
        let n = 0
        for (const r of tables[table]) if (filter(r)) { Object.assign(r, patch); n++ }
        return n
      },
      async del() {
        await Promise.resolve()
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
  // Serialises transactions, modelling the users-row FOR UPDATE lock.
  db.transaction = async (fn: (trx: any) => Promise<any>) => {
    const prev = lock
    let release!: () => void
    lock = new Promise<void>(r => (release = r))
    await prev
    try {
      return await fn(db)
    } finally {
      release()
    }
  }
  db.__tables = tables
  return db
}

function tokenFor(userId: string, sessionId: string) {
  return jwt.sign({ userId, sessionId }, SECRET, { algorithm: 'HS256' })
}

function setup(opts: { hasPassword?: boolean | null; passwordLoginFn?: any; setPasswordFn?: any } = {}) {
  const db = makeFakeDb()
  db.__tables.users.push({
    id: 'u1', email: 'u@e.com', first_name: 'U', last_name: 'E', roles: JSON.stringify(['user']),
    has_password: opts.hasPassword === undefined ? true : opts.hasPassword,
  })
  db.__tables.sessions.push({ id: 's-cur', user_id: 'u1' }, { id: 's-other', user_id: 'u1' }, { id: 's-else', user_id: 'u2' })
  const passwordLoginFn = opts.passwordLoginFn ?? jest.fn().mockResolvedValue({ id: 'u1', email: 'u@e.com', roles: [] })
  const setPasswordFn = opts.setPasswordFn ?? jest.fn().mockResolvedValue(undefined)
  const provider = new AuthentikIdentityProvider({ db, passwordLoginFn, setPasswordFn, now: () => Date.now() } as any)
  return { db, provider, passwordLoginFn, setPasswordFn, token: tokenFor('u1', 's-cur') }
}

const factor = (id: string, status: 'active' | 'pending') => ({ id, user_id: 'u1', type: 'totp', status })

describe('removeFactor — last-factor guard', () => {
  it('refuses to remove the only active factor (LAST_FACTOR) and the factor survives', async () => {
    const { db, provider, token } = setup()
    db.__tables.mfa_factors.push(factor('f1', 'active'))
    await expect(provider.removeFactor(token, 'f1')).rejects.toBeInstanceOf(LastFactorError)
    expect(db.__tables.mfa_factors.map((f: any) => f.id)).toEqual(['f1'])
  })

  it('removes a non-last active factor', async () => {
    const { db, provider, token } = setup()
    db.__tables.mfa_factors.push(factor('f1', 'active'), factor('f2', 'active'))
    await provider.removeFactor(token, 'f1')
    expect(db.__tables.mfa_factors.map((f: any) => f.id)).toEqual(['f2'])
  })

  it('removes a pending factor even when it is the only row (MFA is not enabled by it)', async () => {
    const { db, provider, token } = setup()
    db.__tables.mfa_factors.push(factor('p1', 'pending'))
    await provider.removeFactor(token, 'p1')
    expect(db.__tables.mfa_factors).toHaveLength(0)
  })

  it('removing a pending factor does not count against the active total', async () => {
    const { db, provider, token } = setup()
    db.__tables.mfa_factors.push(factor('f1', 'active'), factor('p1', 'pending'))
    await provider.removeFactor(token, 'p1')
    await expect(provider.removeFactor(token, 'f1')).rejects.toBeInstanceOf(LastFactorError)
  })

  it('is idempotent for an unknown factor id', async () => {
    const { provider, token } = setup()
    await expect(provider.removeFactor(token, 'nope')).resolves.toBeUndefined()
  })

  it("never touches another user's factor", async () => {
    const { db, provider, token } = setup()
    db.__tables.mfa_factors.push({ ...factor('x1', 'active'), user_id: 'u2' }, factor('f1', 'active'), factor('f2', 'active'))
    await provider.removeFactor(token, 'x1')
    expect(db.__tables.mfa_factors.map((f: any) => f.id).sort()).toEqual(['f1', 'f2', 'x1'])
  })

  it('is atomic: two concurrent removals of the last two factors cannot both succeed', async () => {
    const { db, provider, token } = setup()
    db.__tables.mfa_factors.push(factor('f1', 'active'), factor('f2', 'active'))
    const results = await Promise.allSettled([provider.removeFactor(token, 'f1'), provider.removeFactor(token, 'f2')])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(LastFactorError)
    expect(db.__tables.mfa_factors.filter((f: any) => f.status === 'active')).toHaveLength(1)
  })
})

describe('changePassword — provider', () => {
  it('wrong current password -> CurrentPasswordInvalidError, nothing set, sessions untouched', async () => {
    const bad = Object.assign(new Error('bad'), { name: 'InvalidCredentialsError' })
    const { db, provider, token, setPasswordFn } = setup({ passwordLoginFn: jest.fn().mockRejectedValue(bad) })
    await expect(provider.changePassword(token, 'wrong', 'N3w-Passw0rd!')).rejects.toBeInstanceOf(CurrentPasswordInvalidError)
    expect(setPasswordFn).not.toHaveBeenCalled()
    expect(db.__tables.sessions.map((s: any) => s.id)).toEqual(['s-cur', 's-other', 's-else'])
  })

  it.each([[undefined], [{}], [{ id: 'someone-else', email: 'x@e.com', roles: [] }]])(
    'login resolving without the caller\'s id (%p) fails closed, nothing set',
    async resolved => {
      const { provider, token, setPasswordFn } = setup({ passwordLoginFn: jest.fn().mockResolvedValue(resolved) })
      await expect(provider.changePassword(token, 'cur', 'N3w-Passw0rd!')).rejects.toBeInstanceOf(CurrentPasswordInvalidError)
      expect(setPasswordFn).not.toHaveBeenCalled()
    },
  )

  it('provider outage while verifying is NOT reported as a wrong password', async () => {
    const down = Object.assign(new Error('down'), { name: 'AuthentikUnavailableError' })
    const { provider, token } = setup({ passwordLoginFn: jest.fn().mockRejectedValue(down) })
    await expect(provider.changePassword(token, 'x', 'N3w-Passw0rd!')).rejects.toBe(down)
  })

  it('policy rejection -> PasswordPolicyRejectedError, sessions untouched', async () => {
    const policy = Object.assign(new Error('too weak'), { name: 'PasswordPolicyError' })
    const { db, provider, token } = setup({ setPasswordFn: jest.fn().mockRejectedValue(policy) })
    await expect(provider.changePassword(token, 'cur', 'weak')).rejects.toBeInstanceOf(PasswordPolicyRejectedError)
    expect(db.__tables.sessions).toHaveLength(3)
  })

  it.each([false, null])('has_password=%s -> NoPasswordError (nothing verified or set)', async hp => {
    const { provider, token, passwordLoginFn, setPasswordFn } = setup({ hasPassword: hp })
    await expect(provider.changePassword(token, 'cur', 'N3w-Passw0rd!')).rejects.toBeInstanceOf(NoPasswordError)
    expect(passwordLoginFn).not.toHaveBeenCalled()
    expect(setPasswordFn).not.toHaveBeenCalled()
  })

  it('success sets the password and revokes OTHER sessions (keeps the caller and other users)', async () => {
    const { db, provider, token, setPasswordFn } = setup()
    await provider.changePassword(token, 'cur', 'N3w-Passw0rd!')
    expect(setPasswordFn).toHaveBeenCalledWith('u@e.com', 'N3w-Passw0rd!')
    expect(db.__tables.sessions.map((s: any) => s.id).sort()).toEqual(['s-cur', 's-else'])
  })

  it('rejects empty inputs with InvalidInputError', async () => {
    const { provider, token } = setup()
    await expect(provider.changePassword(token, '', 'x')).rejects.toBeInstanceOf(InvalidInputError)
    await expect(provider.changePassword(token, 'x', '')).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('an invalid bearer is rejected (UnauthorizedError)', async () => {
    const { provider } = setup()
    await expect(provider.changePassword('garbage', 'a', 'b')).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

// ── routes ──────────────────────────────────────────────────────────────────
function makeApp(p: Partial<IdentityProvider>) {
  setIdentityProvider(p as IdentityProvider)
  const app = express()
  app.use(express.json())
  app.use('/api/v1/security', securityRouter)
  return app
}
afterEach(() => setIdentityProvider(null))

describe('DELETE /mfa/factors/:id — HTTP', () => {
  it('409 LAST_FACTOR when the provider refuses', async () => {
    const removeFactor = jest.fn().mockRejectedValue(new LastFactorError())
    const res = await request(makeApp({ removeFactor }))
      .delete('/api/v1/security/mfa/factors/f1').set('Authorization', 'Bearer t')
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('LAST_FACTOR')
  })
  it('204 for a removable factor', async () => {
    const removeFactor = jest.fn().mockResolvedValue(undefined)
    const res = await request(makeApp({ removeFactor }))
      .delete('/api/v1/security/mfa/factors/f2').set('Authorization', 'Bearer t')
    expect(res.status).toBe(204)
    expect(removeFactor).toHaveBeenCalledWith('t', 'f2')
  })
})

describe('POST /password/change — HTTP', () => {
  const body = { currentPassword: 'cur', newPassword: 'N3w-Passw0rd!' }
  const post = (p: Partial<IdentityProvider>, b: any = body, auth = true) => {
    const r = request(makeApp(p)).post('/api/v1/security/password/change')
    return (auth ? r.set('Authorization', 'Bearer t') : r).send(b)
  }

  it('401 NO_TOKEN without a bearer, provider never called', async () => {
    const changePassword = jest.fn()
    const res = await post({ changePassword }, body, false)
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('NO_TOKEN')
    expect(changePassword).not.toHaveBeenCalled()
  })
  it('204 on success', async () => {
    const changePassword = jest.fn().mockResolvedValue(undefined)
    const res = await post({ changePassword })
    expect(res.status).toBe(204)
    expect(changePassword).toHaveBeenCalledWith('t', 'cur', 'N3w-Passw0rd!')
  })
  it('400 INVALID_CREDENTIALS for a wrong current password', async () => {
    const res = await post({ changePassword: jest.fn().mockRejectedValue(new CurrentPasswordInvalidError()) })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_CREDENTIALS')
  })
  it('422 PASSWORD_POLICY', async () => {
    const res = await post({ changePassword: jest.fn().mockRejectedValue(new PasswordPolicyRejectedError()) })
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('PASSWORD_POLICY')
  })
  it('409 NO_PASSWORD', async () => {
    const res = await post({ changePassword: jest.fn().mockRejectedValue(new NoPasswordError()) })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('NO_PASSWORD')
  })
  it.each([
    [{ currentPassword: 'a' }],
    [{ newPassword: 'a' }],
    [{ currentPassword: 1, newPassword: 'a' }],
    [{ currentPassword: 'a', newPassword: 'b', id: 'x' }],
  ])('400 MALFORMED for invalid body %j (provider not called)', async b => {
    const changePassword = jest.fn()
    const res = await post({ changePassword }, b)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('MALFORMED')
    expect(changePassword).not.toHaveBeenCalled()
  })
})
