/**
 * Security API shim — exposes /api/v1/security/session (and related) on the
 * main backend using the same local bcrypt-based auth as /api/auth/login.
 *
 * The standalone security-service handles these routes in production via
 * Authentik. This shim bridges CI and local-dev environments where only the
 * main backend runs and Authentik is not available.
 */
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import { User } from '../types/shared'

const router = express.Router()

// POST /session — password login; returns SessionResult (security-client shape)
router.post('/session', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required', code: 'MALFORMED' })
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
    return res.json({ status: 'authenticated', token, user, sessionId })
  } catch (err) {
    console.error('Security session login error:', err)
    return res.status(500).json({ error: 'Authentication failed', code: 'UNKNOWN' })
  }
})

// GET /session — current identity ("me")
router.get('/session', authenticateToken, (req: any, res) => {
  res.json({ user: req.user })
})

// DELETE /session — logout (revoke the current session)
router.delete('/session', authenticateToken, async (req: any, res) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { sessionId?: string }
      if (decoded.sessionId) {
        await db('sessions').where('id', decoded.sessionId).del()
      }
    }
  } catch {
    // ignore errors during logout
  }
  res.status(204).end()
})

// POST /session/exchange — redeem opaque broker code (OIDC callback path)
router.post('/session/exchange', async (req, res) => {
  // Not available on the main-backend shim; used only by the standalone security-service.
  res.status(503).json({ error: 'Exchange not available on this backend', code: 'PROVIDER_UNAVAILABLE' })
})

// GET /methods — neutral auth capability descriptor
router.get('/methods', (_req, res) => {
  res.json({
    password: true,
    social: [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

export default router
