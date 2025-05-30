import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import { User } from '@apphub/shared'

const router = express.Router()

// POST /auth/login - Mock login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }

    // Find user
    const userRow = await db.get<any>('SELECT * FROM users WHERE email = ?', [
      email,
    ])

    if (!userRow) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(
      password,
      userRow.password_hash
    )
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    // Generate JWT
    const token = jwt.sign({ userId: userRow.id }, process.env.JWT_SECRET!, {
      expiresIn: '24h',
    })

    // Create session
    const sessionId = uuidv4()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    await db.run(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
      [sessionId, userRow.id, expiresAt.toISOString()]
    )

    const user: User = {
      id: userRow.id,
      email: userRow.email,
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      defaultAppId: userRow.default_app_id,
      roles: JSON.parse(userRow.roles || '["user"]'),
    }

    res.json({
      token,
      user,
      sessionId,
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /auth/user - Get current user
router.get('/user', authenticateToken, async (req: any, res) => {
  res.json({ user: req.user })
})

// POST /auth/logout
router.post('/logout', authenticateToken, async (req: any, res) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string
      }
      // In a real app, you'd add this token to a blacklist
      // For now, we'll just remove the session
      await db.run('DELETE FROM sessions WHERE user_id = ?', [decoded.userId])
    }

    res.json({ message: 'Logged out successfully' })
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' })
  }
})

export default router
