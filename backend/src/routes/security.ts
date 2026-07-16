import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import { oidcService } from '../services/oidc'
import { User } from '../types/shared'

type JwtPayload = { userId: string; sessionId: string }

const router = express.Router()

// GET /v1/security/methods — neutral capability descriptor.
// Returns which auth mechanisms this instance supports.
router.get('/methods', (_req, res) => {
  const googleEnabled = oidcService.isConfigured()
  res.json({
    password: true,
    social: googleEnabled ? ['google'] : [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

// POST /v1/security/session — password login.
// Response shape: SessionResult (discriminated union on `status`).
router.post('/session', async (req, res) => {
  const requestId = uuidv4().substring(0, 8)
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }

    const userRow = await db('users').where('email', email).first()
    if (!userRow) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const valid = await bcrypt.compare(password, userRow.password_hash)
    if (!valid) {
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

    console.log(`✅ [${requestId}] Security/session login: ${user.email}`)

    res.json({ status: 'authenticated', token, sessionId, user })
  } catch (err) {
    console.error(`💥 [${requestId}] Security/session error:`, err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /v1/security/session — current identity (used by authAPI.getCurrentUser).
// The authenticateToken middleware already fetched the user and attached it to req.user.
router.get('/session', authenticateToken, (req: any, res) => {
  res.json({ user: req.user })
})

// DELETE /v1/security/session — logout (revoke current session).
router.delete('/session', (req, res) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader?.split(' ')[1]
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
      db('sessions').where('id', decoded.sessionId).delete().catch(() => {})
    }
    res.json({ status: 'ok' })
  } catch {
    res.json({ status: 'ok' })
  }
})

export default router
