import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import { oidcService } from '../services/oidc'
import { runInternalProvision } from '../services/organizationProvisioning'

const router = express.Router()

// GET /api/v1/security/methods
// Returns the provider-neutral capability descriptor the LoginPage uses to
// decide which affordances to render (password form, social buttons, MFA, etc.).
router.get('/methods', (req, res) => {
  const oidcConfigured = oidcService.isConfigured()
  res.json({
    password: true,
    social: oidcConfigured ? ['google'] : [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

// POST /api/v1/security/session — password login.
// Returns a SessionResult: { status: 'authenticated', token, sessionId, user }
// or { status: 'mfa_required' } when step-up is needed (not yet implemented).
router.post('/session', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }

  try {
    const userRow = await db('users').where('email', email).first()

    if (!userRow) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const isValidPassword = await bcrypt.compare(password, userRow.password_hash)

    if (!isValidPassword) {
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

    runInternalProvision(userRow.id).catch(err => {
      console.error('Security API: self-heal provisioning failed:', err)
    })

    return res.json({ status: 'authenticated', token, sessionId, user })
  } catch (error) {
    console.error('Security session login error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/v1/security/session — current identity.
// Returns { user } matching the @fuzefront/security-client contract.
router.get('/session', authenticateToken, (req, res) => {
  res.json({ user: req.user })
})

// DELETE /api/v1/security/session — revoke the current session.
router.delete('/session', authenticateToken, async (req, res) => {
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
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' })
  }
})

export default router
