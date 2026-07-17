/**
 * Monolith compatibility shim for the Security API (`/api/v1/security`).
 *
 * The full Security API lives in the standalone `backend/security` service
 * (Authentik-backed). In CI and local dev the monolith runs without that
 * service, so this shim serves the subset of endpoints the SPA needs for
 * basic sign-in, using the monolith's own bcrypt-based users table.
 *
 * Shape matches the frozen `@fuzefront/security-client` contract so the
 * frontend can call `/api/v1/security/session` without branching on env.
 */
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { runInternalProvision } from '../services/organizationProvisioning'

const router = express.Router()

// POST /session — password login (mirrors POST /api/auth/login, returns Security API shape)
router.post('/session', async (req, res) => {
  try {
    const { email, password } = req.body ?? {}
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required', code: 'MALFORMED' })
    }

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

    // Self-heal provisioning in the background (does not block the response).
    runInternalProvision(userRow.id).catch(() => {})

    return res.json({
      status: 'authenticated',
      token,
      sessionId,
      user: {
        id: userRow.id,
        email: userRow.email,
        firstName: userRow.first_name,
        lastName: userRow.last_name,
        defaultAppId: userRow.default_app_id ?? null,
        roles: Array.isArray(userRow.roles)
          ? userRow.roles
          : JSON.parse(userRow.roles || '["user"]'),
      },
    })
  } catch (err) {
    console.error('[security-shim] POST /session error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /session — return the currently authenticated user ("me")
router.get('/session', async (req: any, res) => {
  try {
    const auth = req.headers['authorization']
    if (!auth) return res.status(401).json({ error: 'Missing bearer token' })
    const [, token] = auth.split(' ')
    if (!token) return res.status(401).json({ error: 'Missing bearer token' })

    const decoded: any = jwt.verify(token, process.env.JWT_SECRET!)
    const userRow = await db('users').where('id', decoded.userId).first()
    if (!userRow) return res.status(401).json({ error: 'User not found' })

    return res.json({
      user: {
        id: userRow.id,
        email: userRow.email,
        firstName: userRow.first_name,
        lastName: userRow.last_name,
        defaultAppId: userRow.default_app_id ?? null,
        roles: Array.isArray(userRow.roles)
          ? userRow.roles
          : JSON.parse(userRow.roles || '["user"]'),
      },
    })
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
})

// DELETE /session — logout (revoke session)
router.delete('/session', async (req: any, res) => {
  try {
    const auth = req.headers['authorization']
    if (auth) {
      const [, token] = auth.split(' ')
      if (token) {
        try {
          const decoded: any = jwt.verify(token, process.env.JWT_SECRET!)
          if (decoded.sessionId) {
            await db('sessions').where('id', decoded.sessionId).del()
          }
        } catch {
          // expired / malformed token — still return 200 (logout is idempotent)
        }
      }
    }
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[security-shim] DELETE /session error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /methods — advertise local-only auth (no social providers in monolith mode)
router.get('/methods', (_req, res) => {
  res.json({ password: true, social: [] })
})

export default router
