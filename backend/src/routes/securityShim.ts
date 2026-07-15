/**
 * Minimal shim for the provider-neutral Security API surface (`/api/v1/security`).
 *
 * In production the dedicated security-service (backend/security/) handles these
 * routes (backed by Authentik). The monolith mounts THIS shim so that CI
 * environments — where only the monolith runs and Authentik is absent — can
 * still serve the password-login, session-info, and auth-methods endpoints that
 * the SPA now calls unconditionally.
 *
 * The shim re-uses the same local-DB + bcrypt + JWT logic as /api/auth/login and
 * returns the SAME response shapes as the security-service's routes so the
 * frontend `authAPI.*` calls work identically.
 */
import express, { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'

const router = express.Router()

// POST /v1/security/session — password login (mirrors security-service behaviour)
router.post('/session', async (req: Request, res: Response) => {
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

    const user = {
      id: userRow.id,
      email: userRow.email,
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      defaultAppId: userRow.default_app_id ?? null,
      roles: Array.isArray(userRow.roles) ? userRow.roles : JSON.parse(userRow.roles || '["user"]'),
    }

    // Match the security-service SessionResult shape so `authAPI.login()` sees
    // `status === 'authenticated'` and persists the token.
    return res.status(200).json({ status: 'authenticated', token, sessionId, user })
  } catch (err) {
    console.error('[securityShim] session POST error:', err)
    return res.status(500).json({ error: 'Internal server error', code: 'UNKNOWN' })
  }
})

// GET /v1/security/session — current identity (mirrors security-service behaviour)
router.get('/session', async (req: Request, res: Response) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token', code: 'NO_TOKEN' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
    const userRow = await db('users').where('id', decoded.userId).first()
    if (!userRow) {
      return res.status(401).json({ error: 'User not found', code: 'UNKNOWN' })
    }

    const user = {
      id: userRow.id,
      email: userRow.email,
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      defaultAppId: userRow.default_app_id ?? null,
      roles: Array.isArray(userRow.roles) ? userRow.roles : JSON.parse(userRow.roles || '["user"]'),
    }

    return res.status(200).json({ user, identity: { sub: userRow.id, email: userRow.email } })
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token', code: 'UNKNOWN' })
  }
})

// GET /v1/security/methods — auth-capability descriptor
router.get('/methods', (_req: Request, res: Response) => {
  // No social providers in the monolith shim — social login requires the
  // full security-service + Authentik stack.
  res.status(200).json({
    password: true,
    social: [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

export default router
