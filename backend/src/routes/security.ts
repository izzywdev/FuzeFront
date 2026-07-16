/**
 * Minimal Security API shim under /api/v1/security.
 *
 * The frontend was de-vendored from /api/auth/login onto the provider-neutral
 * Security API (POST /api/v1/security/session, GET /api/v1/security/methods,
 * GET /api/v1/security/session). This shim wires those three endpoints against
 * the same bcrypt+JWT+Postgres logic as the existing /api/auth/login handler so
 * the main backend (started in CI and dev) satisfies them — no separate
 * security-service process needed for e2e tests.
 */
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { User } from '../types/shared'
import { runInternalProvision } from '../services/organizationProvisioning'

const router = express.Router()

// ── Helpers ──────────────────────────────────────────────────────────────────

function bearerToken(req: express.Request): string | null {
  const h = req.headers['authorization']
  if (!h || Array.isArray(h)) return null
  const [scheme, token] = h.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

function rowToUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    defaultAppId: row.default_app_id,
    roles: Array.isArray(row.roles)
      ? row.roles
      : JSON.parse(row.roles || '["user"]'),
  }
}

// ── GET /methods ──────────────────────────────────────────────────────────────
// Returns the capability descriptor the LoginPage uses to decide which UI
// affordances to show. Always reports password=true; no social/MFA in CI.
router.get('/methods', (_req, res) => {
  res.json({
    password: true,
    social: [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

// ── POST /session ─────────────────────────────────────────────────────────────
// Password login. Mirrors /api/auth/login but returns the SessionResult shape
// the frontend expects: { status, token, sessionId, user }.
router.post('/session', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }

  try {
    const userRow = await db('users').where('email', email).first()
    if (!userRow) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }

    const valid = await bcrypt.compare(password, userRow.password_hash)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }

    const sessionId = uuidv4()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const token = jwt.sign(
      { userId: userRow.id, sessionId },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    )

    await db('sessions').insert({ id: sessionId, user_id: userRow.id, expires_at: expiresAt })

    // Fire-and-forget provisioning (same as /api/auth/login).
    runInternalProvision(userRow.id).catch((err: unknown) => {
      console.error('[security] post-login provisioning failed:', err)
    })

    return res.json({
      status: 'authenticated',
      token,
      sessionId,
      user: rowToUser(userRow),
    })
  } catch (err) {
    console.error('[security] POST /session error:', err)
    return res.status(500).json({ error: 'Authentication failed' })
  }
})

// ── GET /session ──────────────────────────────────────────────────────────────
// Current identity ("me"). The frontend calls this immediately after login to
// hydrate the user state; shape: { identity, user }.
router.get('/session', async (req, res) => {
  const token = bearerToken(req)
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token', code: 'NO_TOKEN' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
    const userRow = await db('users').where('id', decoded.userId).first()
    if (!userRow) {
      return res.status(401).json({ error: 'User not found', code: 'NOT_FOUND' })
    }
    const user = rowToUser(userRow)
    return res.json({ identity: { sub: user.id, email: user.email }, user })
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' })
  }
})

// ── DELETE /session ───────────────────────────────────────────────────────────
// Logout — revoke the current session.
router.delete('/session', async (req, res) => {
  const token = bearerToken(req)
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' })
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string
      sessionId?: string
    }
    if (decoded.sessionId) {
      await db('sessions').where('id', decoded.sessionId).del()
    }
    return res.status(204).end()
  } catch {
    return res.status(204).end()
  }
})

export default router
