/**
 * Security API compatibility shim for the main backend.
 *
 * The full Security API lives in backend/security (port 3002). In CI and
 * local dev the main backend (port 3001) is the only process started, so
 * the frontend's calls to /api/v1/security/* would 404.
 *
 * This shim implements the minimal subset the frontend needs to sign in:
 *   GET  /methods  – capability descriptor (password only in CI)
 *   POST /session  – password login → SecurityAPI SessionResult shape
 *   GET  /session  – current user ("me")
 *   DELETE /session – logout (stateless; 204)
 *
 * It reuses the same JWT secret, bcrypt, and sessions table as the legacy
 * /api/auth/* surface so tokens are cross-compatible.
 */
import express, { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { User } from '../types/shared'

const router = express.Router()

// GET /methods — neutral auth capability descriptor
router.get('/methods', (_req: Request, res: Response) => {
  res.json({
    password: true,
    social: [],
    mfa: { enabled: false, types: [] },
    verification: { email: false, sms: false },
  })
})

// POST /session — password login; returns SecurityAPI SessionResult
router.post('/session', async (req: Request, res: Response) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required', code: 'MALFORMED' })
  }

  try {
    const userRow = await db('users').where({ email }).first()
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

    res.json({ status: 'authenticated', token, sessionId, user })
  } catch (err) {
    console.error('[securityCompat] POST /session error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /session — current user ("me"); requires Bearer token
router.get('/session', async (req: Request, res: Response) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token', code: 'NO_TOKEN' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
    const userRow = await db('users')
      .select('id', 'email', 'first_name', 'last_name', 'default_app_id', 'roles')
      .where({ id: decoded.userId })
      .first()

    if (!userRow) {
      return res.status(401).json({ error: 'User not found', code: 'NOT_FOUND' })
    }

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

    res.json({ user })
  } catch (err) {
    console.error('[securityCompat] GET /session error:', err)
    res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' })
  }
})

// DELETE /session — stateless logout; just 204
router.delete('/session', (_req: Request, res: Response) => {
  res.status(204).end()
})

export default router
