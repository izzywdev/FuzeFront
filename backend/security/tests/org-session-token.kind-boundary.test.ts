/**
 * The org-scoped token (`kind: 'fuze-org-session'`, services/orgSessionToken.ts)
 * shares JWT_SECRET with the plain session and carries the same userId +
 * sessionId. It exists to hand ORG-SCOPED services a verified `orgId`; it must
 * not double as an account credential at the Security API.
 *
 * Without the kind check in AuthentikIdentityProvider.verifySessionToken, a
 * 15-minute org token delivered to selection-list-service could set a password,
 * start a social link, regenerate MFA recovery codes or revoke the user's other
 * sessions: account persistence from a narrowed token. The ONE place it is
 * accepted is the authz decision API (`getUserInfo(token, { allowOrgSession })`),
 * which org-scoped services call with that token.
 */
process.env.NODE_ENV = 'test'
process.env.PERMIT_API_KEY = process.env.PERMIT_API_KEY || 'ci-no-real-permit-calls'

import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import authzRoutes from '../src/routes/authz'
import { setIdentityProvider } from '../src/providers/factory'
import { setAuthorizationProvider } from '../src/providers/authzFactory'
import {
  AuthentikIdentityProvider,
  UnauthorizedError,
} from '../src/providers/authentik/AuthentikIdentityProvider'
import { ORG_SESSION_KIND } from '../src/services/orgSessionToken'

jest.mock('../src/services/organizationProvisioning', () => ({
  runInternalProvision: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../src/services/machine-identity', () => ({
  // A non-session bearer must never be rescued by the machine path in this file.
  introspectMachineToken: jest.fn().mockResolvedValue({ active: false }),
}))
jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: { publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined) },
}))

const SECRET = crypto.randomBytes(32).toString('hex')
process.env.JWT_SECRET = SECRET

const USER_ID = '0b3a2f64-7d1e-4c1a-9f0e-2b5f6a7c8d90'
const SESSION_ID = '11111111-2222-4333-8444-555555555555'
const ORG_ID = '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

/** Minimal knex-like fake: `db(t).where(cond).first()` and `.del()`. */
function makeDb() {
  const tables: Record<string, any[]> = {
    users: [{ id: USER_ID, email: 'u@example.com', roles: JSON.stringify(['user']) }],
    sessions: [{ id: SESSION_ID, user_id: USER_ID, expires_at: new Date(Date.now() + 3600_000) }],
  }
  const db: any = (table: string) => {
    let filter = (_r: any) => true
    const api: any = {
      where(cond: any, val?: any) {
        const prev = filter
        filter = (r: any) =>
          prev(r) &&
          (typeof cond === 'string' ? r[cond] === val : Object.entries(cond).every(([k, v]) => r[k] === v))
        return api
      },
      whereNot() {
        return api
      },
      async first() {
        return (tables[table] ?? []).find(filter)
      },
      async del() {
        const before = tables[table].length
        tables[table] = tables[table].filter(r => !filter(r))
        return before - tables[table].length
      },
    }
    return api
  }
  db.__tables = tables
  return db
}

function sign(claims: Record<string, unknown>): string {
  return jwt.sign(claims, SECRET, { algorithm: 'HS256', expiresIn: 900 })
}

const sessionToken = () => sign({ userId: USER_ID, sessionId: SESSION_ID })
const orgToken = () =>
  sign({ userId: USER_ID, sessionId: SESSION_ID, orgId: ORG_ID, kind: ORG_SESSION_KIND })

describe('org-session token is not an account credential at the Security API', () => {
  it('a plain session token still resolves (baseline)', async () => {
    const p = new AuthentikIdentityProvider({ db: makeDb() })
    const { user } = await p.getUserInfo(sessionToken())
    expect(user.id).toBe(USER_ID)
  })

  it('getUserInfo refuses an org token by default', async () => {
    const p = new AuthentikIdentityProvider({ db: makeDb() })
    await expect(p.getUserInfo(orgToken())).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('getUserInfo accepts an org token ONLY with allowOrgSession (authz decision API)', async () => {
    const p = new AuthentikIdentityProvider({ db: makeDb() })
    const { user } = await p.getUserInfo(orgToken(), { allowOrgSession: true })
    expect(user.id).toBe(USER_ID)
  })

  it('allowOrgSession does not open the door to any OTHER kind', async () => {
    const p = new AuthentikIdentityProvider({ db: makeDb() })
    for (const kind of ['fuze-workload', 'fuze-delegation', 'fuze-org-session-x', 42, null]) {
      const t = sign({ userId: USER_ID, sessionId: SESSION_ID, kind })
      await expect(p.getUserInfo(t, { allowOrgSession: true })).rejects.toBeInstanceOf(UnauthorizedError)
    }
  })

  it('an org token cannot drive account-management operations', async () => {
    const db = makeDb()
    const p = new AuthentikIdentityProvider({ db })
    const t = orgToken()
    await expect(p.listSessions(t)).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(p.revokeOtherSessions(t)).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(p.regenerateRecoveryCodes(t)).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(p.setPassword(t, 'a-new-Passw0rd!')).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(p.startSocialLink(t, 'google')).rejects.toBeInstanceOf(UnauthorizedError)
    // ...and the session it was minted from is untouched.
    expect(db.__tables.sessions).toHaveLength(1)
  })

  it('an org token introspects as inactive (not a user session)', async () => {
    const p = new AuthentikIdentityProvider({
      db: makeDb(),
      introspectM2M: async () => ({ active: false }),
    })
    await expect(p.introspectToken(orgToken())).resolves.toEqual({ active: false })
    await expect(p.introspectToken(sessionToken())).resolves.toMatchObject({ active: true, subject: USER_ID })
  })

  it('logout with an org token revokes nothing', async () => {
    const db = makeDb()
    const p = new AuthentikIdentityProvider({ db })
    await p.logout(orgToken())
    expect(db.__tables.sessions).toHaveLength(1)
  })
})

describe('the authz decision API still accepts the org token (selection-list-service forwards it)', () => {
  const check = jest.fn().mockResolvedValue(true)

  function app() {
    const a = express()
    a.use(express.json())
    a.use('/api/v1/security', authzRoutes)
    return a
  }

  beforeEach(() => {
    check.mockClear()
    setIdentityProvider(new AuthentikIdentityProvider({ db: makeDb() }) as any)
    setAuthorizationProvider({ check } as any)
  })
  afterEach(() => {
    setIdentityProvider(null)
    setAuthorizationProvider(null)
  })

  const body = { tenant: ORG_ID, resource: { type: 'SelectionListCatalog' }, action: 'list' }

  it('POST /authz/check with an org token -> decided for that user', async () => {
    const res = await request(app())
      .post('/api/v1/security/authz/check')
      .set('Authorization', `Bearer ${orgToken()}`)
      .send(body)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ allow: true })
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ subject: USER_ID, tenant: ORG_ID }))
  })

  it('POST /authz/check with a workload-kind token signed by the same secret -> 401', async () => {
    const t = sign({ userId: USER_ID, sessionId: SESSION_ID, kind: 'fuze-workload' })
    const res = await request(app()).post('/api/v1/security/authz/check').set('Authorization', `Bearer ${t}`).send(body)
    expect(res.status).toBe(401)
    expect(check).not.toHaveBeenCalled()
  })
})
