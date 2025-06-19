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
  var _a, _b, _c, _d, _e
  const requestId = (0, uuid_1.v4)().substring(0, 8)
  const startTime = Date.now()
  console.log(`🔐 [${requestId}] Login request received:`, {
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    origin: req.get('Origin'),
    referer: req.get('Referer'),
    contentType: req.get('Content-Type'),
    bodyKeys: Object.keys(req.body || {}),
    hasEmail: !!((_a = req.body) === null || _a === void 0 ? void 0 : _a.email),
    hasPassword: !!((_b = req.body) === null || _b === void 0
      ? void 0
      : _b.password),
    emailDomain: ((_c = req.body) === null || _c === void 0 ? void 0 : _c.email)
      ? req.body.email.split('@')[1]
      : 'none',
  })
  try {
    const { email, password } = req.body
    if (!email || !password) {
      console.log(`❌ [${requestId}] Missing credentials:`, {
        hasEmail: !!email,
        hasPassword: !!password,
        responseTime: Date.now() - startTime,
      })
      return res.status(400).json({ error: 'Email and password required' })
    }
    console.log(`🔍 [${requestId}] Looking up user:`, {
      email,
      passwordLength: password.length,
    })
    // Find user
    const userRow = await (0, database_1.db)('users')
      .where('email', email)
      .first()
    if (!userRow) {
      console.log(`❌ [${requestId}] User not found:`, {
        email,
        responseTime: Date.now() - startTime,
      })
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    console.log(`👤 [${requestId}] User found:`, {
      userId: userRow.id,
      email: userRow.email,
      hasPasswordHash: !!userRow.password_hash,
      roles: userRow.roles,
    })
    // Verify password
    console.log(`🔒 [${requestId}] Verifying password...`)
    const isValidPassword = await bcryptjs_1.default.compare(
      password,
      userRow.password_hash
    )
    if (!isValidPassword) {
      console.log(`❌ [${requestId}] Invalid password:`, {
        email,
        responseTime: Date.now() - startTime,
      })
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    console.log(`✅ [${requestId}] Password verified, generating token...`)
    // Generate JWT
    const token = jsonwebtoken_1.default.sign(
      { userId: userRow.id },
      process.env.JWT_SECRET,
      {
        expiresIn: '24h',
      }
    )
    console.log(`🎫 [${requestId}] JWT token generated:`, {
      tokenLength: token.length,
      tokenPreview: token.substring(0, 20) + '...',
    })
    // Create session
    const sessionId = (0, uuid_1.v4)()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    console.log(`💾 [${requestId}] Creating session:`, {
      sessionId,
      expiresAt: expiresAt.toISOString(),
    })
    await (0, database_1.db)('sessions').insert({
      id: sessionId,
      user_id: userRow.id,
      expires_at: expiresAt,
    })
    // Debug logging for roles parsing
    console.log(`🔍 [${requestId}] Parsing roles:`, {
      rawRoles: userRow.roles,
      rolesType: typeof userRow.roles,
      rolesLength:
        (_d = userRow.roles) === null || _d === void 0 ? void 0 : _d.length,
      firstChar:
        (_e = userRow.roles) === null || _e === void 0 ? void 0 : _e[0],
      fallback: '["user"]',
    })
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
    console.log(`🎉 [${requestId}] Login successful:`, {
      userId: user.id,
      email: user.email,
      roles: user.roles,
      sessionId,
      responseTime: Date.now() - startTime,
    })
    res.json({
      token,
      user,
      sessionId,
    })
  } catch (error) {
    console.error(`💥 [${requestId}] Login error:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      responseTime: Date.now() - startTime,
    })
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
