/**
 * Thin adapter that exposes the `/api/v1/security` surface on the monolith
 * backend (port 3001). The security-service (port 3002) is the canonical home
 * for these routes; this adapter bridges the gap for CI and local dev where
 * only the monolith is started.
 *
 * Implements only the two endpoints the frontend unconditionally calls:
 *   GET  /methods  — static capability descriptor
 *   POST /session  — password login; returns the SessionResult shape expected
 *                    by the `@fuzefront/security-client` contract
 */
import express, { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { runInternalProvision } from '../services/organizationProvisioning'

const router = express.Router()

router.get('/methods', (_req: Request, res: Response) => {
  const social: Array<'google'> =
    process.env.SECURITY_SOCIAL_GOOGLE === 'false' ? [] : ['google']
  res.status(200).json({
    password: true,
    social,
    mfa: { enabled: true, types: ['totp', 'sms', 'email'] },
    verification: { email: true, sms: true },
  })
})

router.post('/session', async (req: Request, res: Response) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required', code: 'MALFORMED' })
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

    // Fire-and-forget self-heal provisioning (mirrors /api/auth/login)
    runInternalProvision(userRow.id).catch((err: Error) =>
      console.error(`[security-adapter] self-heal provisioning failed for ${userRow.id}:`, err)
    )

    return res.status(200).json({
      status: 'authenticated',
      token,
      sessionId,
      user: {
        id: userRow.id,
        email: userRow.email,
        firstName: userRow.first_name,
        lastName: userRow.last_name,
        defaultAppId: userRow.default_app_id ?? null,
        roles: Array.isArray(userRow.roles)
          ? userRow.roles
          : JSON.parse(userRow.roles || '["user"]'),
      },
    })
  } catch (err) {
    console.error('[security-adapter] POST /session error:', err)
    return res.status(500).json({ error: 'Authentication failed', code: 'UNKNOWN' })
  }
})

export default router
