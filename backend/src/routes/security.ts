import express from 'express'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import { User } from '../types/shared'
import { oidcService } from '../services/oidc'
import { runInternalProvision } from '../services/organizationProvisioning'

// Re-use the same fire-and-forget provisioning pattern as the auth router.
function selfHealProvisioningOnLogin(userId: string): void {
  runInternalProvision(userId).catch(err => {
    console.error(`Security API login self-heal provisioning failed for ${userId}:`, err)
  })
}

const FRONTEND_BASE = (process.env.FRONTEND_URL || 'http://fuzefront.dev.local').replace(/\/$/, '')

const CODE_TTL_MS = 60_000
interface PendingCode { token: string; sessionId: string; expiresAt: number }
const pendingCodes = new Map<string, PendingCode>()
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of pendingCodes) {
    if (value.expiresAt < now) pendingCodes.delete(key)
  }
}, CODE_TTL_MS).unref()

const loginRateLimiter = rateLimit({
  windowMs: 5 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again later.' },
})

const router = express.Router()

// GET /v1/security/methods — neutral auth capability descriptor
router.get('/methods', (req, res) => {
  const oidcConfigured = oidcService.isConfigured()
  res.json({
    password: true,
    social: oidcConfigured ? ['google'] : [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

// POST /v1/security/session — password login
// Returns SessionResult: { status: 'authenticated', token, sessionId, user }
router.post('/session', loginRateLimiter, async (req, res) => {
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

    selfHealProvisioningOnLogin(user.id)

    // SessionResult discriminant so the frontend can narrow on `status`.
    return res.json({ status: 'authenticated', token, sessionId, user })
  } catch (error) {
    console.error('Security API session POST error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /v1/security/session — fetch the authenticated user's profile
router.get('/session', authenticateToken, (req, res) => {
  res.json({ user: req.user })
})

// DELETE /v1/security/session — revoke the current session
router.delete('/session', authenticateToken, async (req: any, res) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; sessionId?: string }
      if (decoded.sessionId) {
        await db('sessions').where('id', decoded.sessionId).del()
      }
    }
    res.json({ message: 'Logged out successfully' })
  } catch {
    res.status(500).json({ error: 'Logout failed' })
  }
})

// POST /v1/security/signup — server-brokered account creation
router.post('/signup', async (req, res) => {
  const { email, password, firstName, lastName } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }

  try {
    const existing = await db('users').where('email', email).first()
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const userId = uuidv4()
    await db('users').insert({
      id: userId,
      email,
      password_hash: passwordHash,
      first_name: firstName || null,
      last_name: lastName || null,
      roles: JSON.stringify(['user']),
    })

    const sessionId = uuidv4()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const token = jwt.sign({ userId, sessionId }, process.env.JWT_SECRET!, { expiresIn: '24h' })
    await db('sessions').insert({ id: sessionId, user_id: userId, expires_at: expiresAt })

    selfHealProvisioningOnLogin(userId)

    return res.status(201).json({
      token,
      sessionId,
      user: { id: userId, email, firstName: firstName || null, lastName: lastName || null, roles: ['user'] },
    })
  } catch (error) {
    console.error('Security API signup error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /v1/security/social/:provider/start — begin social login (redirect)
router.get('/social/:provider/start', async (req, res) => {
  if (!oidcService.isConfigured()) {
    return res.status(503).json({ error: 'Social sign-in is not configured' })
  }
  if (!oidcService.isInitialized()) {
    try { await oidcService.initialize() } catch {
      return res.status(503).json({ error: 'Authentication service unavailable' })
    }
  }
  const state = uuidv4()
  const authUrl = oidcService.generateAuthUrl(state)
  res.redirect(authUrl)
})

// POST /v1/security/session/exchange — redeem a single-use code from the social callback
router.post('/session/exchange', async (req, res) => {
  const { code } = req.body || {}
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code required' })
  }
  const pending = pendingCodes.get(code)
  if (!pending || Date.now() > pending.expiresAt) {
    pendingCodes.delete(code)
    return res.status(401).json({ error: 'invalid or expired code' })
  }
  pendingCodes.delete(code)
  return res.json({ status: 'authenticated', token: pending.token, sessionId: pending.sessionId })
})

export default router
