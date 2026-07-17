/**
 * Security API — /api/v1/security/*
 *
 * Provider-neutral authentication surface matching the @fuzefront/security-client
 * contract types (SessionResult, AuthMethods). This is the endpoint the frontend
 * authAPI talks to; the legacy /api/auth/* routes remain for backwards compat.
 */
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import { oidcService } from '../services/oidc'
import { runInternalProvision } from '../services/organizationProvisioning'

const router = express.Router()

// GET /v1/security/methods — advertise available auth capabilities
router.get('/methods', (req, res) => {
  const oidcConfigured = oidcService.isConfigured()
  res.json({
    password: true,
    social: oidcConfigured ? ['google'] : [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

// POST /v1/security/session — password login → SessionResult
router.post('/session', async (req, res) => {
  const { email, password } = req.body || {}

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }

  try {
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

    await db('sessions').insert({ id: sessionId, user_id: userRow.id, expires_at: expiresAt })

    const user = {
      id: userRow.id,
      email: userRow.email,
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      defaultAppId: userRow.default_app_id,
      roles: Array.isArray(userRow.roles)
        ? userRow.roles
        : JSON.parse(userRow.roles || '["user"]'),
    }

    // Fire-and-forget provisioning (does not block the login response)
    runInternalProvision(userRow.id).catch(err =>
      console.error(`Security login self-heal provisioning failed for ${userRow.id}:`, err)
    )

    // SessionResult shape: status discriminates authenticated vs mfa_required
    return res.json({ status: 'authenticated', token, sessionId, user })
  } catch (err) {
    console.error('Security session POST error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /v1/security/session — current identity ("me")
router.get('/session', authenticateToken, (req: any, res) => {
  res.json({ user: req.user })
})

// DELETE /v1/security/session — logout (revoke session)
router.delete('/session', authenticateToken, async (req: any, res) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]
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
