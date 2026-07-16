/**
 * Compatibility shim: exposes the provider-neutral `/api/v1/security/*` surface
 * that the frontend SPA calls since the de-vendor migration (PR #250). This lets
 * the main backend serve CI/local dev without the separate security-service
 * container. Delegates to the same bcrypt/JWT logic already in auth.ts.
 *
 * Routes mirror the frozen OpenAPI contract in packages/security/openapi.yaml:
 *   GET  /methods  → AuthMethods capability descriptor
 *   POST /session  → password login → SessionResult (authenticated | mfa_required)
 *   GET  /session  → current session identity
 *   DELETE /session → logout
 */
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import { runInternalProvision } from '../services/organizationProvisioning'

const router = express.Router()

// GET /methods — neutral auth capability descriptor.
// Password-only for the monolith; social/MFA are handled by the full
// security-service when deployed separately.
router.get('/methods', (_req, res) => {
  res.json({
    password: true,
    social: [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

// POST /session — password login, returns SessionResult.
router.post('/session', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required', code: 'MALFORMED' })
  }

  try {
    const userRow = await db('users').where('email', email).first()
    if (!userRow || !userRow.password_hash) {
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

    const roles = Array.isArray(userRow.roles)
      ? userRow.roles
      : JSON.parse(userRow.roles || '["user"]')

    // Fire-and-forget provisioning (same as the legacy /api/auth/login route).
    runInternalProvision(userRow.id).catch(err =>
      console.error('[securityCompat] provisioning failed:', err)
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
        roles,
      },
    })
  } catch (err) {
    console.error('[securityCompat] /session error:', err)
    return res.status(401).json({ error: 'Authentication failed', code: 'UNKNOWN' })
  }
})

// GET /session — current identity (mirrors /api/auth/user).
router.get('/session', authenticateToken, (req: any, res) => {
  res.json({ status: 'authenticated', user: req.user })
})

// DELETE /session — logout; invalidates the current session token.
router.delete('/session', authenticateToken, async (req: any, res) => {
  try {
    const sessionId = req.user?.sessionId
    if (sessionId) {
      await db('sessions').where({ id: sessionId }).delete()
    }
    res.json({ status: 'ok' })
  } catch (err) {
    console.error('[securityCompat] /session DELETE error:', err)
    res.status(500).json({ error: 'Logout failed' })
  }
})

export default router
