'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const express_1 = __importDefault(require('express'))
const bcryptjs_1 = __importDefault(require('bcryptjs'))
const jsonwebtoken_1 = __importDefault(require('jsonwebtoken'))
const uuid_1 = require('uuid')
const database_1 = require('../config/database')
const auth_1 = require('../middleware/auth')
const router = express_1.default.Router()
// POST /auth/login - Mock login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }
    // Find user
    const userRow = await database_1.db.get(
      'SELECT * FROM users WHERE email = ?',
      [email]
    )
    if (!userRow) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    // Verify password
    const isValidPassword = await bcryptjs_1.default.compare(
      password,
      userRow.password_hash
    )
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    // Generate JWT
    const token = jsonwebtoken_1.default.sign(
      { userId: userRow.id },
      process.env.JWT_SECRET,
      {
        expiresIn: '24h',
      }
    )
    // Create session
    const sessionId = (0, uuid_1.v4)()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    await database_1.db.run(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
      [sessionId, userRow.id, expiresAt.toISOString()]
    )
    const user = {
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
router.get('/user', auth_1.authenticateToken, async (req, res) => {
  res.json({ user: req.user })
})
// POST /auth/logout
router.post('/logout', auth_1.authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]
    if (token) {
      const decoded = jsonwebtoken_1.default.verify(
        token,
        process.env.JWT_SECRET
      )
      // In a real app, you'd add this token to a blacklist
      // For now, we'll just remove the session
      await database_1.db.run('DELETE FROM sessions WHERE user_id = ?', [
        decoded.userId,
      ])
    }
    res.json({ message: 'Logged out successfully' })
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' })
  }
})
exports.default = router
//# sourceMappingURL=auth.js.map
