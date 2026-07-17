// Local-auth shim for /api/v1/security/* — used by the main monolith (port 3001)
// in CI and local-auth environments where the real security-service (port 3002)
// with its Authentik identity provider is unavailable.
//
// Implements the two endpoints the SPA requires for a password sign-in:
//   POST /session  — bcrypt credential check; returns the Security-API SessionResult shape
//   GET  /session  — JWT-protected "me"; returns { user }
//
// The shape matches what @fuzefront/security-client / the real security-service
// produce so the frontend can consume either interchangeably.
import express, { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'

const router = express.Router()

function userFromRow(row: any) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    roles: Array.isArray(row.roles)
      ? row.roles
      : JSON.parse(row.roles || '["user"]'),
  }
}

// POST /v1/security/session — password sign-in (bcrypt, local users table)
router.post('/session', async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }

  const userRow = await db('users').where('email', email).first().catch(() => null)
  if (!userRow?.password_hash) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  const valid = await bcrypt.compare(password, userRow.password_hash)
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  const sessionId = uuidv4()
  const token = jwt.sign(
    { userId: userRow.id, sessionId },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  )

  await db('sessions').insert({
    id: sessionId,
    user_id: userRow.id,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }).catch(() => undefined) // non-fatal if sessions table absent

  return res.status(200).json({
    status: 'authenticated',
    token,
    sessionId,
    user: userFromRow(userRow),
  })
})

// GET /v1/security/session — current identity ("me"), reads Bearer JWT
router.get('/session', async (req: Request, res: Response) => {
  const bearer = req.headers.authorization?.split(' ')[1]
  if (!bearer) {
    return res.status(401).json({ error: 'No token provided' })
  }

  let payload: { userId: string }
  try {
    payload = jwt.verify(bearer, process.env.JWT_SECRET!) as { userId: string }
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }

  const userRow = await db('users').where('id', payload.userId).first().catch(() => null)
  if (!userRow) {
    return res.status(401).json({ error: 'User not found' })
  }

  return res.status(200).json({ user: userFromRow(userRow) })
})

export default router
