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
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: User login
 *     description: Authenticate user with email and password, returns JWT token
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           example:
 *             email: "admin@frontfuse.dev"
 *             password: "admin123"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/LoginResponse'
 *                 - type: object
 *                   properties:
 *                     sessionId:
 *                       type: string
 *                       format: uuid
 *                       description: Session identifier
 *             example:
 *               token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *               user:
 *                 id: "550e8400-e29b-41d4-a716-446655440000"
 *                 email: "admin@frontfuse.dev"
 *                 firstName: "Admin"
 *                 lastName: "User"
 *                 roles: ["admin", "user"]
 *               sessionId: "123e4567-e89b-12d3-a456-426614174000"
 *       400:
 *         description: Missing email or password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Email and password required"
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid credentials"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// POST /auth/login - Mock login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }
    // Find user
    const userRow = await (0, database_1.db)('users')
      .where('email', email)
      .first()
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
    await (0, database_1.db)('sessions').insert({
      id: sessionId,
      user_id: userRow.id,
      expires_at: expiresAt,
    })
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
/**
 * @swagger
 * /api/auth/user:
 *   get:
 *     summary: Get current user
 *     description: Get information about the currently authenticated user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *             example:
 *               user:
 *                 id: "550e8400-e29b-41d4-a716-446655440000"
 *                 email: "admin@frontfuse.dev"
 *                 firstName: "Admin"
 *                 lastName: "User"
 *                 roles: ["admin", "user"]
 *       401:
 *         description: Access token required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// GET /auth/user - Get current user
router.get('/user', auth_1.authenticateToken, async (req, res) => {
  res.json({ user: req.user })
})
/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: User logout
 *     description: Logout the current user and invalidate their session
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Logged out successfully"
 *       500:
 *         description: Logout failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
      await (0, database_1.db)('sessions')
        .where('user_id', decoded.userId)
        .del()
    }
    res.json({ message: 'Logged out successfully' })
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' })
  }
})
exports.default = router
//# sourceMappingURL=auth.js.map
