/**
 * Security API compatibility shim for the monolith.
 *
 * The frontend calls the provider-agnostic `/api/v1/security/*` surface (the
 * canonical route owned by the standalone security-service). In production the
 * monolith is deprecated in favour of that service; in CI (where only the
 * monolith is started) these routes re-implement the minimum subset needed for
 * the e2e test to pass using the existing bcrypt/JWT infrastructure.
 *
 * Only the session lifecycle and capability-discovery routes are implemented —
 * MFA, social login, and verification are absent here (they require the full
 * security-service and are not exercised by the CI Playwright suite).
 */
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { User } from '../types/shared'

const router = express.Router()

function buildUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    defaultAppId: row.default_app_id,
    roles: Array.isArray(row.roles)
      ? row.roles
      : JSON.parse(row.roles || '["user"]'),
  }
}

// POST /api/v1/security/session — password login (security-service format)
router.post('/session', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required', code: 'MALFORMED' })
  }
  try {
    const row = await db('users').where('email', email).first()
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }
    const sessionId = uuidv4()
    const token = jwt.sign(
      { userId: row.id, sessionId },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    )
    await db('sessions').insert({
      id: sessionId,
      user_id: row.id,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    return res.status(200).json({
      status: 'authenticated',
      token,
      sessionId,
      user: buildUser(row),
    })
  } catch (err) {
    console.error('[security-compat] POST /session error:', err)
    return res.status(401).json({ error: 'Authentication failed', code: 'UNKNOWN' })
  }
})

// GET /api/v1/security/session — current identity ("me")
router.get('/session', async (req, res) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token', code: 'NO_TOKEN' })
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
    const row = await db('users')
      .select('id', 'email', 'first_name', 'last_name', 'default_app_id', 'roles')
      .where('id', decoded.userId)
      .first()
    if (!row) {
      return res.status(401).json({ error: 'User not found', code: 'NOT_ACTIVE' })
    }
    const user = buildUser(row)
    return res.status(200).json({
      identity: { sub: user.id, email: user.email },
      user,
    })
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token', code: 'NOT_ACTIVE' })
  }
})

// DELETE /api/v1/security/session — logout
router.delete('/session', async (req, res) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string; sessionId?: string
      }
      if (decoded.sessionId) {
        await db('sessions').where('id', decoded.sessionId).del()
      }
    } catch {
      // expired / invalid — still respond 204 (idempotent)
    }
  }
  return res.status(204).end()
})

// GET /api/v1/security/methods — capability descriptor
router.get('/methods', (_req, res) => {
  return res.status(200).json({
    password: true,
    social: [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

export default router
