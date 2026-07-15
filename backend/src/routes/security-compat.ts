// Compatibility shim: maps /api/v1/security/* onto the monolith's local-DB auth.
// The canonical implementation lives in backend/security/ (the security-service).
// This shim exists so the E2E CI environment — which runs only the monolith — has
// a working /api/v1/security surface while the full split is rolled out.
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import type { User } from '../types/shared'
import { runInternalProvision } from '../services/organizationProvisioning'

const router = express.Router()

// GET /methods — static auth capability descriptor (local-DB mode: password only)
router.get('/methods', (_req, res) => {
  res.json({
    password: true,
    social: [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

// POST /session — password login; mirrors POST /api/auth/login but returns the
// SessionResult shape { status, token, sessionId, user } the security-client expects.
router.post('/session', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }

    const userRow = await db('users').where('email', email).first()
    if (!userRow) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }

    const isValid = await bcrypt.compare(password, userRow.password_hash)
    if (!isValid) {
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

    // Fire-and-forget provisioning (same as the legacy login path).
    runInternalProvision(user.id).catch(err =>
      console.error('[security-compat] provision error:', err)
    )

    res.status(200).json({ status: 'authenticated', token, sessionId, user })
  } catch (err) {
    console.error('[security-compat] POST /session error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /session — current identity; mirrors GET /api/auth/user.
// Returns { user } to match the security-client's getCurrentUser() shape.
router.get('/session', authenticateToken, (req: any, res) => {
  res.json({ user: req.user })
})

// DELETE /session — logout; mirrors POST /api/auth/logout.
router.delete('/session', authenticateToken, async (req: any, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1]
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string
        sessionId?: string
      }
      if (decoded.sessionId) {
        await db('sessions').where('id', decoded.sessionId).del()
      }
    }
    res.json({ message: 'Logged out successfully' })
  } catch {
    res.status(500).json({ error: 'Logout failed' })
  }
})

export default router
