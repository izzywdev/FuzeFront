/**
 * Unit tests for the self-service password-reset flow.
 *
 * Covers the provider logic (token minting/validation, identity-store password
 * set, session revocation) and the route contract (unconditional 202, no user
 * enumeration). Uses the same in-memory knex-like fake + injected deps as the
 * sibling provider tests — no network, no DB.
 *
 * The security-critical invariants asserted here:
 *   - an unknown email is INDISTINGUISHABLE from a known one (always 202)
 *   - only the SHA-256 of the token is ever persisted
 *   - expired / consumed / wrong tokens all fail closed
 *   - a completed reset revokes EVERY existing session for the account
 *   - the credential is set in the identity store, never stored locally
 */
import crypto from 'crypto'
import express from 'express'
import request from 'supertest'
import { AuthentikIdentityProvider } from '../src/providers/authentik/AuthentikIdentityProvider'
import type { NotificationClient } from '../src/providers/authentik/notifications'

process.env.JWT_SECRET = 'test-secret'
// A deliverable email channel — the enabled path. The degrade path clears this.
process.env.EMAIL_SERVICE_URL = 'http://email-service:3000'

jest.mock('../src/services/organizationProvisioning', () => ({
  runInternalProvision: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: { publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined) },
}))

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex')

// ── Minimal in-memory knex-like fake (adds whereRaw for the email lookup) ────
function matches(row: any, cond: any, val?: any): boolean {
  if (typeof cond === 'string') return row[cond] === val
  return Object.entries(cond).every(([k, v]) => row[k] === v)
}
function makeFakeDb() {
  const tables: Record<string, any[]> = {
    users: [],
    sessions: [],
    password_resets: [],
    mfa_factors: [],
  }
  function qb(table: string) {
    let filter = (_r: any) => true
    const api: any = {
      where(cond: any, val?: any) {
        const prev = filter
        filter = (r: any) => prev(r) && matches(r, cond, val)
        return api
      },
      andWhere(cond: any, val?: any) {
        return api.where(cond, val)
      },
      // Only the `LOWER(email) = ?` shape the provider issues is modelled.
      whereRaw(_sql: string, bindings: any[]) {
        const prev = filter
        const want = String(bindings[0]).toLowerCase()
        filter = (r: any) => prev(r) && String(r.email || '').toLowerCase() === want
        return api
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
        return Promise.resolve(tables[table].filter(filter)).then(resolve)
      },
    }
    return api
  }
  const db: any = (table: string) => qb(table)
  db.__tables = tables
  return db
}

function makeNotifications(): NotificationClient & { sendPasswordReset: jest.Mock } {
  return {
    sendSmsOtp: jest.fn().mockResolvedValue(undefined),
    checkSmsOtp: jest.fn().mockResolvedValue(true),
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  } as any
}

function newProvider(db: any, overrides: any = {}) {
  return new AuthentikIdentityProvider({
    db,
    notifications: overrides.notifications ?? makeNotifications(),
    setPasswordFn: overrides.setPasswordFn ?? jest.fn().mockResolvedValue(undefined),
    now: overrides.now ?? (() => Date.now()),
    ...overrides,
  })
}

function seedUser(db: any, email = 'user@example.com', id = 'u1') {
  db.__tables.users.push({ id, email, first_name: 'A', last_name: 'B', roles: JSON.stringify(['user']) })
  return id
}

/** The raw token as the user would receive it — captured from the dispatch. */
function dispatchedToken(notifications: any): string {
  expect(notifications.sendPasswordReset).toHaveBeenCalled()
  return notifications.sendPasswordReset.mock.calls[0][1]
}

describe('requestPasswordReset', () => {
  it('mints a hashed, expiring token and dispatches the raw one to the user', async () => {
    const db = makeFakeDb()
    seedUser(db)
    const notifications = makeNotifications()
    const provider = newProvider(db, { notifications })

    await provider.requestPasswordReset('user@example.com')

    const rows = db.__tables.password_resets
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).toBe('u1')
    expect(rows[0].consumed).toBe(false)
    expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(Date.now())

    // The RAW token must never be persisted — only its sha256.
    const raw = dispatchedToken(notifications)
    expect(rows[0].token_hash).toBe(sha256(raw))
    expect(JSON.stringify(rows)).not.toContain(raw)
  })

  it('resolves silently for an unknown email and mints nothing (no enumeration)', async () => {
    const db = makeFakeDb()
    seedUser(db)
    const notifications = makeNotifications()
    const provider = newProvider(db, { notifications })

    await expect(provider.requestPasswordReset('nobody@example.com')).resolves.toBeUndefined()

    expect(db.__tables.password_resets).toHaveLength(0)
    expect(notifications.sendPasswordReset).not.toHaveBeenCalled()
  })

  it('resolves email case-insensitively', async () => {
    const db = makeFakeDb()
    seedUser(db, 'User@Example.com')
    const provider = newProvider(db)

    await provider.requestPasswordReset('user@example.COM')

    expect(db.__tables.password_resets).toHaveLength(1)
  })

  it('supersedes an outstanding challenge so only one token stays live', async () => {
    const db = makeFakeDb()
    seedUser(db)
    const provider = newProvider(db)

    await provider.requestPasswordReset('user@example.com')
    await provider.requestPasswordReset('user@example.com')

    const live = db.__tables.password_resets.filter((r: any) => !r.consumed)
    expect(db.__tables.password_resets).toHaveLength(2)
    expect(live).toHaveLength(1)
  })

  it('gracefully degrades (mints nothing, still resolves) when no email channel is wired', async () => {
    const prev = process.env.EMAIL_SERVICE_URL
    delete process.env.EMAIL_SERVICE_URL
    try {
      const db = makeFakeDb()
      seedUser(db)
      const notifications = makeNotifications()
      const provider = newProvider(db, { notifications })

      await expect(provider.requestPasswordReset('user@example.com')).resolves.toBeUndefined()

      expect(db.__tables.password_resets).toHaveLength(0)
      expect(notifications.sendPasswordReset).not.toHaveBeenCalled()
    } finally {
      process.env.EMAIL_SERVICE_URL = prev
    }
  })

  it('burns the token and still resolves when dispatch fails (no enumeration oracle)', async () => {
    const db = makeFakeDb()
    seedUser(db)
    const notifications = makeNotifications()
    notifications.sendPasswordReset.mockRejectedValue(new Error('email-service down'))
    const provider = newProvider(db, { notifications })

    await expect(provider.requestPasswordReset('user@example.com')).resolves.toBeUndefined()

    expect(db.__tables.password_resets.every((r: any) => r.consumed)).toBe(true)
  })
})

describe('confirmPasswordReset', () => {
  it('happy path: sets the password in the identity store, consumes the token, revokes sessions', async () => {
    const db = makeFakeDb()
    seedUser(db)
    db.__tables.sessions.push(
      { id: 's1', user_id: 'u1' },
      { id: 's2', user_id: 'u1' },
      { id: 'other', user_id: 'u2' } // another user's session must survive
    )
    const notifications = makeNotifications()
    const setPasswordFn = jest.fn().mockResolvedValue(undefined)
    const provider = newProvider(db, { notifications, setPasswordFn })

    await provider.requestPasswordReset('user@example.com')
    const raw = dispatchedToken(notifications)

    await expect(provider.confirmPasswordReset(raw, 'N3wPassw0rd!')).resolves.toBeUndefined()

    // Credential set in the identity store — NOT stored locally.
    expect(setPasswordFn).toHaveBeenCalledWith('user@example.com', 'N3wPassw0rd!')
    expect(JSON.stringify(db.__tables.users)).not.toContain('N3wPassw0rd!')

    expect(db.__tables.password_resets[0].consumed).toBe(true)

    // Every session for THIS user is gone; the other user's is untouched.
    expect(db.__tables.sessions.filter((s: any) => s.user_id === 'u1')).toHaveLength(0)
    expect(db.__tables.sessions.filter((s: any) => s.user_id === 'u2')).toHaveLength(1)
  })

  it('rejects an expired token and leaves sessions intact', async () => {
    const db = makeFakeDb()
    seedUser(db)
    db.__tables.sessions.push({ id: 's1', user_id: 'u1' })
    const notifications = makeNotifications()
    let clock = Date.now()
    const setPasswordFn = jest.fn().mockResolvedValue(undefined)
    const provider = newProvider(db, { notifications, setPasswordFn, now: () => clock })

    await provider.requestPasswordReset('user@example.com')
    const raw = dispatchedToken(notifications)

    clock += 31 * 60_000 // past the 30-minute TTL

    await expect(provider.confirmPasswordReset(raw, 'N3wPassw0rd!')).rejects.toThrow(
      /invalid or expired/i
    )
    expect(setPasswordFn).not.toHaveBeenCalled()
    expect(db.__tables.sessions).toHaveLength(1)
  })

  it('rejects a reused (already consumed) token', async () => {
    const db = makeFakeDb()
    seedUser(db)
    const notifications = makeNotifications()
    const setPasswordFn = jest.fn().mockResolvedValue(undefined)
    const provider = newProvider(db, { notifications, setPasswordFn })

    await provider.requestPasswordReset('user@example.com')
    const raw = dispatchedToken(notifications)

    await provider.confirmPasswordReset(raw, 'FirstPassw0rd!')
    expect(setPasswordFn).toHaveBeenCalledTimes(1)

    // Single-use: the second presentation must fail closed.
    await expect(provider.confirmPasswordReset(raw, 'SecondPassw0rd!')).rejects.toThrow(
      /invalid or expired/i
    )
    expect(setPasswordFn).toHaveBeenCalledTimes(1)
  })

  it('rejects a wrong/unknown token', async () => {
    const db = makeFakeDb()
    seedUser(db)
    const setPasswordFn = jest.fn().mockResolvedValue(undefined)
    const provider = newProvider(db, { setPasswordFn })

    await provider.requestPasswordReset('user@example.com')

    await expect(
      provider.confirmPasswordReset('deadbeef'.repeat(8), 'N3wPassw0rd!')
    ).rejects.toThrow(/invalid or expired/i)
    expect(setPasswordFn).not.toHaveBeenCalled()
  })

  it('keeps the token live when the identity store rejects the password', async () => {
    const db = makeFakeDb()
    seedUser(db)
    const notifications = makeNotifications()
    const policyError = Object.assign(new Error('too weak'), { name: 'PasswordPolicyError' })
    const setPasswordFn = jest.fn().mockRejectedValueOnce(policyError).mockResolvedValue(undefined)
    const provider = newProvider(db, { notifications, setPasswordFn })

    await provider.requestPasswordReset('user@example.com')
    const raw = dispatchedToken(notifications)

    await expect(provider.confirmPasswordReset(raw, 'weak')).rejects.toThrow('too weak')
    // Not consumed — a compliant retry with the same token must still work.
    expect(db.__tables.password_resets[0].consumed).toBe(false)

    await expect(provider.confirmPasswordReset(raw, 'N3wPassw0rd!')).resolves.toBeUndefined()
    expect(db.__tables.password_resets[0].consumed).toBe(true)
  })

  it('requires both token and newPassword', async () => {
    const provider = newProvider(makeFakeDb())
    await expect(provider.confirmPasswordReset('', 'x')).rejects.toThrow(/token is required/)
    await expect(provider.confirmPasswordReset('t', '')).rejects.toThrow(/newPassword is required/)
  })
})

// ── Route contract ──────────────────────────────────────────────────────────
describe('password-reset routes', () => {
  const provider = {
    requestPasswordReset: jest.fn().mockResolvedValue(undefined),
    confirmPasswordReset: jest.fn().mockResolvedValue(undefined),
  }

  function app() {
    jest.doMock('../src/providers/factory', () => ({ getIdentityProvider: () => provider }))
    const a = express()
    a.use(express.json())
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    a.use('/v1/security', require('../src/routes/security').default)
    return a
  }

  beforeEach(() => {
    jest.resetModules()
    provider.requestPasswordReset.mockReset().mockResolvedValue(undefined)
    provider.confirmPasswordReset.mockReset().mockResolvedValue(undefined)
  })

  it('reset-request returns 202 for a known email', async () => {
    await request(app())
      .post('/v1/security/session/password/reset-request')
      .send({ email: 'user@example.com' })
      .expect(202)
  })

  it('reset-request returns the SAME 202 for an unknown email (no enumeration)', async () => {
    const known = await request(app())
      .post('/v1/security/session/password/reset-request')
      .send({ email: 'user@example.com' })
    const unknown = await request(app())
      .post('/v1/security/session/password/reset-request')
      .send({ email: 'nobody@example.com' })

    expect(unknown.status).toBe(202)
    expect(unknown.status).toBe(known.status)
    expect(unknown.text).toBe(known.text)
  })

  it('reset-request still returns 202 when the provider throws (no oracle)', async () => {
    provider.requestPasswordReset.mockRejectedValue(new Error('store down'))
    await request(app())
      .post('/v1/security/session/password/reset-request')
      .send({ email: 'user@example.com' })
      .expect(202)
  })

  it('reset-request 400s only on a malformed body', async () => {
    await request(app()).post('/v1/security/session/password/reset-request').send({}).expect(400)
  })

  it('reset-confirm returns { reset: true } on success', async () => {
    const res = await request(app())
      .post('/v1/security/session/password/reset-confirm')
      .send({ token: 'tok', newPassword: 'N3wPassw0rd!' })
      .expect(200)
    expect(res.body).toEqual({ reset: true })
  })

  it('reset-confirm 400s on an invalid token', async () => {
    const { InvalidInputError } = require('../src/providers/authentik/AuthentikIdentityProvider')
    provider.confirmPasswordReset.mockRejectedValue(new InvalidInputError('invalid or expired reset token'))
    await request(app())
      .post('/v1/security/session/password/reset-confirm')
      .send({ token: 'bad', newPassword: 'N3wPassw0rd!' })
      .expect(400)
  })

  it('reset-confirm 400s on a missing field', async () => {
    await request(app())
      .post('/v1/security/session/password/reset-confirm')
      .send({ token: 'tok' })
      .expect(400)
  })

  it('never names the identity vendor in a response', async () => {
    const res = await request(app())
      .post('/v1/security/session/password/reset-confirm')
      .send({ token: 'tok', newPassword: 'N3wPassw0rd!' })
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('authentik')
  })
})
