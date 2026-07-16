/**
 * Compatibility shim: exposes the provider-neutral Security API surface
 * (`/api/v1/security/*`) directly from the monolith backend so the E2E CI
 * workflow (which only starts this service) can exercise the same paths the
 * frontend calls after the de-vendor migration (commit 73ec424).
 *
 * These endpoints mirror the shape of backend/security/src/routes/security.ts
 * but run against the monolith's own DB pool — no cross-service call required
 * in CI where the security-service is not started separately.
 */
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import { User } from '../types/shared'

const router = express.Router()

// GET /methods — neutral auth capability descriptor.
// Matches the security-service response shape. Tells the LoginPage which
// affordances to render; password is always enabled in CI.
router.get('/methods', (_req, res) => {
  res.json({
    password: true,
    social: [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

// POST /session — password login returning a SessionResult.
// Shape matches security-service `authenticatedSession()`:
//   { status: 'authenticated', token, sessionId, user }
// The frontend's authAPI.login() keys on `status === 'authenticated'` before
// persisting the token; the legacy /api/auth/login response lacked `status`.
router.post('/session', async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }

    const userRow = await db('users').where('email', email).first()
    if (!userRow) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const isValid = await bcrypt.compare(password, userRow.password_hash)
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const sessionId = uuidv4()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const token = jwt.sign(
      { userId: userRow.id, sessionId },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    )
    await db('sessions').insert({
      id: sessionId,
      user_id: userRow.id,
      expires_at: expiresAt,
    })

    const user: User = {
      id: userRow.id,
      email: userRow.email,
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      defaultAppId: userRow.default_app_id,
      roles: Array.isArray(userRow.roles)
        ? userRow.roles
        : JSON.parse(userRow.roles || '["user"]'),
    }

    return res.json({ status: 'authenticated', token, sessionId, user })
  } catch (err) {
    console.error('[security-compat] POST /session error:', err)
    return res.status(500).json({ error: 'Authentication failed' })
  }
})

// GET /session — current identity ("me").
// Returns { user } so authAPI.getCurrentUser() can extract response.data.user.
router.get('/session', authenticateToken, (req: any, res) => {
  res.json({ user: req.user })
})

export default router
