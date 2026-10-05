/**
 * The host backend's authenticateToken accepts ONLY a plain platform session.
 *
 * backend/security's org exchange (services/orgSessionToken.ts) mints
 * `{ userId, sessionId, tid, orgId, kind: 'fuze-org-session' }` under the shared
 * JWT_SECRET, for org-scoped services (selection-list-service). It, and the
 * `fuze-workload` / `fuze-delegation` kinds, must never authenticate here as
 * the user: same rule as @fuzefront/core's authenticateToken.
 */
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { initializeDatabase, db } from '../src/config/database'
import { authenticateToken } from '../src/middleware/auth'

const ADMIN_EMAIL = 'admin@fuzefront.dev'

describe('host backend authenticateToken — token kind', () => {
  let app: express.Application
  let userId: string

  beforeAll(async () => {
    await initializeDatabase()
    const row = await db('users').where({ email: ADMIN_EMAIL }).first('id')
    userId = row.id
    app = express()
    app.get('/whoami', authenticateToken as any, (req: any, res) => res.json({ id: req.user.id }))
  })

  const sign = (claims: Record<string, unknown>) =>
    jwt.sign({ userId, ...claims }, process.env.JWT_SECRET!, { expiresIn: 60 })

  it('a plain session token authenticates', async () => {
    const res = await request(app).get('/whoami').set('Authorization', `Bearer ${sign({})}`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(userId)
  })

  it('a non-HS256 token signed with the same secret is refused (algorithm is pinned)', async () => {
    const t = jwt.sign({ userId }, process.env.JWT_SECRET!, { algorithm: 'HS512', expiresIn: 60 })
    const res = await request(app).get('/whoami').set('Authorization', `Bearer ${t}`)
    expect(res.status).toBe(401)
  })

  it.each(['fuze-org-session', 'fuze-workload', 'fuze-delegation'])(
    'a token with kind=%s is refused (401)',
    async kind => {
      const t = sign({ orgId: '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f', kind })
      const res = await request(app).get('/whoami').set('Authorization', `Bearer ${t}`)
      expect(res.status).toBe(401)
    }
  )
})
