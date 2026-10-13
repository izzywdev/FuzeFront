/**
 * authenticateToken accepts ONLY a plain platform session.
 *
 * The Security API's org exchange (backend/security services/orgSessionToken.ts)
 * mints `{ userId, sessionId, tid, orgId, kind: 'fuze-org-session' }` under the
 * same JWT_SECRET. Before the kind check, that 15-minute token — handed to
 * org-scoped services such as selection-list-service — authenticated every
 * core-guarded route as the full user, including POST /api/tokens (a long-lived
 * `ff_live_` API token). These tests pin the refusal, and that a plain session
 * still authenticates.
 */
import crypto from 'crypto'
import jwt from 'jsonwebtoken'

const USER_ID = '0b3a2f64-7d1e-4c1a-9f0e-2b5f6a7c8d90'
const SESSION_ID = '11111111-2222-4333-8444-555555555555'

jest.mock('../../src/config/database', () => {
  const rows: Record<string, any> = {
    users: {
      id: '0b3a2f64-7d1e-4c1a-9f0e-2b5f6a7c8d90',
      email: 'u@example.com',
      first_name: 'U',
      last_name: 'X',
      default_app_id: null,
      roles: ['user'],
    },
    sessions: { id: '11111111-2222-4333-8444-555555555555', expires_at: new Date(Date.now() + 3600_000) },
  }
  const db = jest.fn((table: string) => {
    const chain: any = {}
    chain.select = jest.fn(() => chain)
    chain.where = jest.fn(() => chain)
    chain.first = jest.fn(async () => rows[table])
    return chain
  })
  return { db }
})

import { authenticateToken } from '../../src/middleware/auth'

const SECRET = crypto.randomBytes(32).toString('hex')

function run(token: string) {
  const req: any = { headers: { authorization: `Bearer ${token}` } }
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(b: unknown) {
      this.body = b
      return this
    },
  }
  const next = jest.fn()
  return Promise.resolve(authenticateToken(req, res, next)).then(() => ({ req, res, next }))
}

describe('@fuzefront/core authenticateToken — token kind', () => {
  const prev = process.env.JWT_SECRET
  beforeAll(() => {
    process.env.JWT_SECRET = SECRET
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterAll(() => {
    process.env.JWT_SECRET = prev
    jest.restoreAllMocks()
  })

  it('a plain session token authenticates', async () => {
    const t = jwt.sign({ userId: USER_ID, sessionId: SESSION_ID, tid: 'fuzefront' }, SECRET, { expiresIn: 60 })
    const { req, next, res } = await run(t)
    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
    expect(req.user.id).toBe(USER_ID)
  })

  it.each(['fuze-org-session', 'fuze-workload', 'fuze-delegation', 'anything-new'])(
    'a token with kind=%s is refused (401) even with a live session',
    async kind => {
      const t = jwt.sign(
        { userId: USER_ID, sessionId: SESSION_ID, tid: 'fuzefront', orgId: 'x', kind },
        SECRET,
        { expiresIn: 60 }
      )
      const { req, next, res } = await run(t)
      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(401)
      expect(req.user).toBeUndefined()
    }
  )

  it('alg is pinned to HS256 (an HS512 token under the same secret is refused)', async () => {
    const t = jwt.sign({ userId: USER_ID, sessionId: SESSION_ID }, SECRET, { algorithm: 'HS512', expiresIn: 60 })
    const { next, res } = await run(t)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })
})
