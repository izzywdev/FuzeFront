import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import { User } from '../types/shared'
import { oidcService } from '../services/oidc'
import { runInternalProvision } from '../services/organizationProvisioning'
import { redeemExchangeCode } from './auth'

const router = express.Router()

function mintSession(userId: string): { token: string; sessionId: string; expiresAt: Date } {
  const sessionId = uuidv4()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const token = jwt.sign({ userId, sessionId }, process.env.JWT_SECRET!, { expiresIn: '24h' })
  return { token, sessionId, expiresAt }
}

function parseRoles(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[]
  try { return JSON.parse(String(raw)) } catch { return ['user'] }
}

function rowToUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    defaultAppId: row.default_app_id,
    roles: parseRoles(row.roles),
  }
}

function selfHeal(userId: string): void {
  runInternalProvision(userId).catch(err =>
    console.error(`Security API self-heal provisioning failed for ${userId}:`, err)
  )
}

// GET /methods — neutral auth-capability descriptor
router.get('/methods', (req, res) => {
  const oidcConfigured = oidcService.isConfigured()
  res.json({
    password: true,
    social: oidcConfigured ? ['google'] : [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

// POST /session — password login; returns SessionResult
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

    const valid = await bcrypt.compare(password, userRow.password_hash)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const { token, sessionId, expiresAt } = mintSession(userRow.id)
    await db('sessions').insert({ id: sessionId, user_id: userRow.id, expires_at: expiresAt })

    const user = rowToUser(userRow)
    selfHeal(user.id)

    return res.json({ status: 'authenticated', token, sessionId, user })
  } catch (err) {
    console.error('Security session POST error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /session — current identity ("me")
router.get('/session', authenticateToken, (req, res) => {
  const user = req.user as User
  const identity = {
    userId: user.id,
    tenantId: null,
    roles: user.roles,
    email: user.email,
    authMode: 'legacy-hs256',
  }
  return res.json({ identity, user })
})

// DELETE /session — logout
router.delete('/session', authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { sessionId?: string }
      if (decoded.sessionId) {
        await db('sessions').where('id', decoded.sessionId).del()
      }
    }
    return res.json({ message: 'Logged out successfully' })
  } catch {
    return res.json({ message: 'Logged out' })
  }
})

// POST /signup — server-brokered account creation
router.post('/signup', async (req, res) => {
  const { email, password, firstName, lastName } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }

  try {
    const existing = await db('users').where('email', email).first()
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' })
    }

    const password_hash = await bcrypt.hash(password, 10)
    const id = uuidv4()
    await db('users').insert({
      id,
      email,
      password_hash,
      first_name: firstName || null,
      last_name: lastName || null,
      roles: JSON.stringify(['user']),
    })

    const userRow = await db('users').where('id', id).first()
    const user = rowToUser(userRow)

    const { token, sessionId, expiresAt } = mintSession(id)
    await db('sessions').insert({ id: sessionId, user_id: id, expires_at: expiresAt })
    selfHeal(id)

    return res.status(201).json({ token, user, sessionId })
  } catch (err) {
    console.error('Security signup error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /social/:provider/start — begin social login (OIDC redirect)
router.get('/social/:provider/start', async (req, res) => {
  if (!oidcService.isConfigured()) {
    return res.status(503).json({ error: 'Social sign-in is not configured' })
  }
  try {
    if (!oidcService.isInitialized()) {
      await oidcService.initialize()
    }
    const state = uuidv4()
    const authUrl = oidcService.generateAuthUrl(state)
    return res.redirect(authUrl)
  } catch (err) {
    console.error('Security social start error:', err)
    return res.status(500).json({ error: 'Failed to start social sign-in' })
  }
})

// POST /session/exchange — exchange single-use opaque code for a session token
// The code is issued by /api/auth/oidc/callback and stored in the pendingCodes map.
router.post('/session/exchange', (req, res) => {
  const { code } = req.body || {}
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code required' })
  }
  const result = redeemExchangeCode(code)
  if (!result) {
    return res.status(401).json({ error: 'invalid or expired code' })
  }
  return res.json({ status: 'authenticated', token: result.token, sessionId: result.sessionId })
})

export default router
