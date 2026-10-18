/**
 * Email-verification hardening (FFRNT-360 review):
 *  - the verification target is the ACCOUNT's email, never a client-supplied one
 *  - anonymous start resolves the user server-side (unknown address = silent no-op)
 *  - confirm never reports verified unless a user row was actually updated
 *  - spent/unknown tokens are 400 TOKEN_EXPIRED / TOKEN_INVALID, not 401
 */
import crypto from 'crypto'
import request from 'supertest'

process.env.REQUIRE_EMAIL_VERIFICATION = 'true'
process.env.EMAIL_SERVICE_URL = 'http://email-service:3000'
process.env.PERMIT_API_KEY = process.env.PERMIT_API_KEY || 'test'
process.env.PUBLIC_SEND_RATE_LIMIT = '2' // per-IP cap exercised in the route tests below

import {
  AuthentikIdentityProvider,
  TokenError,
} from '../src/providers/authentik/AuthentikIdentityProvider'
import type { NotificationClient } from '../src/providers/authentik/notifications'

jest.mock('../src/services/organizationProvisioning', () => ({
  runInternalProvision: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: { publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined) },
}))

const routeProvider: any = {
  startEmailVerification: jest.fn(),
  confirmEmailVerification: jest.fn(),
}
jest.mock('../src/providers/factory', () => ({ getIdentityProvider: () => routeProvider }))

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex')

function matches(row: any, cond: any, val?: any): boolean {
  if (typeof cond === 'string') return row[cond] === val
  return Object.entries(cond).every(([k, v]) => row[k] === v)
}
function makeFakeDb() {
  const tables: Record<string, any[]> = { users: [], sessions: [], email_verifications: [] }
  function qb(table: string) {
    let filter = (_r: any) => true
    const api: any = {
      where(cond: any, val?: any) {
        const prev = filter
        filter = (r: any) => prev(r) && matches(r, cond, val)
        return api
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

function makeNotifications() {
  return {
    sendSmsOtp: jest.fn().mockResolvedValue(undefined),
    checkSmsOtp: jest.fn().mockResolvedValue(true),
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  } as NotificationClient & { sendEmailVerification: jest.Mock }
}

function newProvider(db: any, notifications: any, now?: () => number) {
  const p: any = new AuthentikIdentityProvider({
    db,
    notifications,
    now,
    setPasswordFn: jest.fn(),
  } as any)
  // Bypass the session/JWT machinery: getUserInfo is exercised elsewhere.
  p.getUserInfo = async (token: string) => ({
    user: db.__tables.users.find((u: any) => `tok-${u.id}` === token),
  })
  return p as AuthentikIdentityProvider
}

function seed(db: any) {
  db.__tables.users.push(
    { id: 'u1', email: 'victim@example.com', email_verified: false },
    { id: 'u2', email: 'other@example.com', email_verified: false },
  )
}
const sentToken = (n: any) => n.sendEmailVerification.mock.calls[0][1] as string
const sentCode = (n: any) => n.sendEmailVerification.mock.calls[0][2] as string

describe('startEmailVerification — target binding', () => {
  it('IGNORES an attacker-supplied email when authenticated and mails the account email', async () => {
    const db = makeFakeDb(); seed(db)
    const n = makeNotifications()
    const p = newProvider(db, n)
    await p.startEmailVerification('tok-u1', 'attacker@evil.test')
    expect(n.sendEmailVerification).toHaveBeenCalledTimes(1)
    expect(n.sendEmailVerification.mock.calls[0][0]).toBe('victim@example.com')
    expect(db.__tables.email_verifications[0].email).toBe('victim@example.com')
    expect(db.__tables.email_verifications[0].user_id).toBe('u1')
  })

  it('anonymous start resolves the user by email server-side (user_id never null)', async () => {
    const db = makeFakeDb(); seed(db)
    const n = makeNotifications()
    const p = newProvider(db, n)
    await p.startEmailVerification(null, 'VICTIM@example.com')
    expect(db.__tables.email_verifications).toHaveLength(1)
    expect(db.__tables.email_verifications[0].user_id).toBe('u1')
    expect(n.sendEmailVerification.mock.calls[0][0]).toBe('victim@example.com')
  })

  it('anonymous start for an unknown address is a silent no-op (no row, no mail, no throw)', async () => {
    const db = makeFakeDb(); seed(db)
    const n = makeNotifications()
    const p = newProvider(db, n)
    await expect(p.startEmailVerification(null, 'nobody@example.com')).resolves.toBeUndefined()
    expect(db.__tables.email_verifications).toHaveLength(0)
    expect(n.sendEmailVerification).not.toHaveBeenCalled()
  })

  it('anonymous dispatch failure is swallowed (no enumeration oracle) but authenticated is surfaced', async () => {
    const n = makeNotifications()
    n.sendEmailVerification.mockRejectedValue(new Error('boom'))
    const db1 = makeFakeDb(); seed(db1)
    await expect(newProvider(db1, n).startEmailVerification(null, 'victim@example.com')).resolves.toBeUndefined()
    await new Promise(r => setImmediate(r)) // let the fire-and-forget rejection be handled
    const db2 = makeFakeDb(); seed(db2)
    await expect(newProvider(db2, n).startEmailVerification('tok-u1')).rejects.toThrow('boom')
  })

  it('anonymous start does not wait on the mail send (no known-vs-unknown timing gap)', async () => {
    const db = makeFakeDb(); seed(db)
    const n = makeNotifications()
    n.sendEmailVerification.mockReturnValue(new Promise(() => undefined)) // never settles
    await expect(newProvider(db, n).startEmailVerification(null, 'victim@example.com')).resolves.toBeUndefined()
    expect(n.sendEmailVerification).toHaveBeenCalledTimes(1)
  })

  it('cooldown coalesces a repeat start into the live challenge (one row, one mail), then allows a resend', async () => {
    const db = makeFakeDb(); seed(db)
    const n = makeNotifications()
    let clock = Date.now()
    const p = newProvider(db, n, () => clock)
    await p.startEmailVerification('tok-u1')
    clock += 5_000
    await p.startEmailVerification('tok-u1')
    await p.startEmailVerification(null, 'victim@example.com')
    expect(n.sendEmailVerification).toHaveBeenCalledTimes(1)
    expect(db.__tables.email_verifications).toHaveLength(1)
    clock += 61_000
    await p.startEmailVerification('tok-u1')
    expect(n.sendEmailVerification).toHaveBeenCalledTimes(2)
  })

  it('passes the tenant mail origin from the registry, never from the request', async () => {
    const { runWithTenant } = require('../src/providers/authentik/tenants')
    const db = makeFakeDb(); seed(db)
    const n = makeNotifications()
    const p = newProvider(db, n)
    await runWithTenant({ appBaseUrl: 'https://acme.example.com' } as any, () =>
      p.startEmailVerification('tok-u1', 'attacker@evil.test'),
    )
    expect(n.sendEmailVerification.mock.calls[0][3]).toBe('https://acme.example.com')
  })
})

describe('confirmEmailVerification', () => {
  async function started(db: any, n: any, now?: () => number) {
    const p = newProvider(db, n, now)
    await p.startEmailVerification('tok-u1')
    return p
  }

  it('verifies the owning user and reports verified', async () => {
    const db = makeFakeDb(); seed(db)
    const n = makeNotifications()
    const p = await started(db, n)
    await expect(p.confirmEmailVerification({ token: sentToken(n) })).resolves.toEqual({
      emailVerified: true,
      phoneVerified: false,
    })
    expect(db.__tables.users[0].email_verified).toBe(true)
    expect(db.__tables.users[1].email_verified).toBe(false)
  })

  it('works with the OTP code too', async () => {
    const db = makeFakeDb(); seed(db)
    const n = makeNotifications()
    const p = await started(db, n)
    await p.confirmEmailVerification({ code: sentCode(n) })
    expect(db.__tables.users[0].email_verified).toBe(true)
  })

  it('does NOT report verified when the row has no user (legacy user_id: null rows)', async () => {
    const db = makeFakeDb(); seed(db)
    const p = newProvider(db, makeNotifications())
    db.__tables.email_verifications.push({
      id: 'v1', user_id: null, email: 'victim@example.com', token_hash: sha256('t'),
      code_hash: sha256('123456'), expires_at: new Date(Date.now() + 60_000), consumed: false,
    })
    await expect(p.confirmEmailVerification({ token: 't' })).rejects.toMatchObject({ code: 'TOKEN_INVALID' })
    expect(db.__tables.users.every((u: any) => !u.email_verified)).toBe(true)
  })

  it('does NOT verify when the challenge email no longer matches the account email', async () => {
    const db = makeFakeDb(); seed(db)
    const n = makeNotifications()
    const p = await started(db, n)
    db.__tables.users[0].email = 'changed@example.com' // account email moved after the mail went out
    await expect(p.confirmEmailVerification({ token: sentToken(n) })).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    })
    expect(db.__tables.users[0].email_verified).toBe(false)
  })

  it('does NOT verify a user whose challenge row targets a different mailbox', async () => {
    const db = makeFakeDb(); seed(db)
    const p = newProvider(db, makeNotifications())
    db.__tables.email_verifications.push({
      id: 'v2', user_id: 'u1', email: 'attacker@evil.test', token_hash: sha256('t2'),
      code_hash: sha256('654321'), expires_at: new Date(Date.now() + 60_000), consumed: false,
    })
    await expect(p.confirmEmailVerification({ token: 't2' })).rejects.toMatchObject({ code: 'TOKEN_INVALID' })
    expect(db.__tables.users[0].email_verified).toBe(false)
  })

  it('OTP: a spent row with the same code does not shadow the live one', async () => {
    const db = makeFakeDb(); seed(db)
    const p = newProvider(db, makeNotifications())
    const base = { user_id: 'u1', email: 'victim@example.com', code_hash: sha256('424242'), expires_at: new Date(Date.now() + 60_000) }
    db.__tables.email_verifications.push(
      { id: 'old', ...base, token_hash: sha256('a'), consumed: true },
      { id: 'live', ...base, token_hash: sha256('b'), consumed: false },
    )
    await expect(p.confirmEmailVerification({ code: '424242' })).resolves.toMatchObject({ emailVerified: true })
    expect(db.__tables.users[0].email_verified).toBe(true)
    // now only spent rows remain -> expired, not invalid
    await expect(p.confirmEmailVerification({ code: '424242' })).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
  })

  it('unknown -> TOKEN_INVALID; reused -> TOKEN_EXPIRED; past TTL -> TOKEN_EXPIRED', async () => {
    const db = makeFakeDb(); seed(db)
    const n = makeNotifications()
    let clock = Date.now()
    const p = await started(db, n, () => clock)

    await expect(p.confirmEmailVerification({ token: 'nope' })).rejects.toBeInstanceOf(TokenError)
    await expect(p.confirmEmailVerification({ token: 'nope' })).rejects.toMatchObject({ code: 'TOKEN_INVALID' })

    const tok = sentToken(n)
    await p.confirmEmailVerification({ token: tok })
    await expect(p.confirmEmailVerification({ token: tok })).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })

    const db2 = makeFakeDb(); seed(db2)
    const n2 = makeNotifications()
    const p2 = await started(db2, n2, () => clock)
    clock += 31 * 60_000
    await expect(p2.confirmEmailVerification({ token: sentToken(n2) })).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    })
  })
})

describe('verify/email routes — error mapping', () => {
  function app() {
    const express = require('express')
    const router = require('../src/routes/security').default
    const a = express()
    a.use(express.json())
    a.use('/v1/security', router)
    return a
  }

  it('per-IP limiter: throttled requests get the SAME 202 and send nothing', async () => {
    routeProvider.startEmailVerification.mockReset().mockResolvedValue(undefined)
    routeProvider.requestPasswordReset = jest.fn().mockResolvedValue(undefined)
    const a = app()
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) {
      statuses.push((await request(a).post('/v1/security/verify/email/start').send({ email: 'a@b.co' })).status)
    }
    expect(statuses).toEqual([202, 202, 202, 202])
    expect(routeProvider.startEmailVerification).toHaveBeenCalledTimes(2) // cap=2, rest throttled
    const reset: number[] = []
    for (let i = 0; i < 4; i++) {
      reset.push((await request(a).post('/v1/security/session/password/reset-request').send({ email: 'a@b.co' })).status)
    }
    expect(reset).toEqual([202, 202, 202, 202])
    expect(routeProvider.requestPasswordReset).toHaveBeenCalledTimes(2)
  })

  it.each(['TOKEN_EXPIRED', 'TOKEN_INVALID'])('confirm maps %s to 400 (not 401)', async code => {
    routeProvider.confirmEmailVerification.mockRejectedValueOnce(new TokenError(code as any))
    const res = await request(app()).post('/v1/security/verify/email/confirm').send({ token: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe(code)
  })
})
