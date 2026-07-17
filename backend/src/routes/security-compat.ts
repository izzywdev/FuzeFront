/**
 * Compatibility shim: mounts the Security API surface (/api/v1/security/*)
 * on the monolith using local bcrypt auth so the E2E tests and the frontend
 * work against a single-service stack (no separate security-service process).
 *
 * Only the subset of routes the SPA actually exercises is implemented:
 *   POST   /session      — password login
 *   GET    /session      — current identity ("me")
 *   DELETE /session      — logout
 *   GET    /methods      — auth capability descriptor
 *
 * The response shapes match the frozen OpenAPI contract that the real
 * security-service implements, so the frontend cannot tell the difference.
 */
import express, { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { runInternalProvision } from '../services/organizationProvisioning'

const router = express.Router()

function bearer(req: Request): string | null {
  const h = req.headers['authorization']
  if (!h || Array.isArray(h)) return null
  const [scheme, token] = h.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

function rowToUser(row: any) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    defaultAppId: row.default_app_id ?? null,
    roles: Array.isArray(row.roles) ? row.roles : JSON.parse(row.roles || '["user"]'),
  }
}

// POST /session — password login
router.post('/session', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {}
    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required', code: 'MALFORMED' })
      return
    }

    const userRow = await db('users').where('email', email).first()
    if (!userRow) {
      res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
      return
    }

    const valid = await bcrypt.compare(password, userRow.password_hash)
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
      return
    }

    const sessionId = uuidv4()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const token = jwt.sign(
      { userId: userRow.id, sessionId },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    )

    await db('sessions').insert({ id: sessionId, user_id: userRow.id, expires_at: expiresAt })

    // Fire-and-forget org provisioning (same as the legacy /api/auth/login path).
    runInternalProvision(userRow.id).catch(() => undefined)

    res.status(200).json({
      status: 'authenticated',
      token,
      sessionId,
      user: rowToUser(userRow),
    })
  } catch (err) {
    console.error('[security-compat] POST /session error:', err)
    res.status(401).json({ error: 'Authentication failed', code: 'UNKNOWN' })
  }
})

// GET /session — current identity ("me")
router.get('/session', async (req: Request, res: Response) => {
  const token = bearer(req)
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token', code: 'NO_TOKEN' })
    return
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
    const userRow = await db('users').where('id', decoded.userId).first()
    if (!userRow) {
      res.status(401).json({ error: 'User not found', code: 'NOT_FOUND' })
      return
    }
    const user = rowToUser(userRow)
    res.status(200).json({ identity: { sub: user.id, email: user.email }, user })
  } catch (err) {
    res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' })
  }
})

// DELETE /session — logout (idempotent)
router.delete('/session', async (req: Request, res: Response) => {
  const token = bearer(req)
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { sessionId?: string }
      if (decoded.sessionId) {
        await db('sessions').where('id', decoded.sessionId).delete()
      }
    } catch {
      // Expired / invalid token — still treat as logged out.
    }
  }
  res.status(204).end()
})

// GET /methods — capability descriptor (local auth only, no social/MFA in CI)
router.get('/methods', (_req: Request, res: Response) => {
  res.status(200).json({
    password: true,
    social: [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

export default router
