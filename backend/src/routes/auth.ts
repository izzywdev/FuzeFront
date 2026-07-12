import crypto from 'crypto'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import { User } from '../types/shared'
import { oidcService } from '../services/oidc'
import {
  authentikPasswordLogin,
  InvalidCredentialsError,
  AuthentikUnavailableError,
  UnsupportedFlowStageError,
} from '../services/authentikPassword'
import { runInternalProvision } from '../services/organizationProvisioning'

const FRONTEND_BASE = (process.env.FRONTEND_URL || 'http://fuzefront.dev.local').replace(/\/$/, '')

const CODE_TTL_MS = 60_000
interface PendingCode { token: string; sessionId: string; expiresAt: number }
const pendingCodes = new Map<string, PendingCode>()
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of pendingCodes) {
    if (value.expiresAt < now) pendingCodes.delete(key)
  }
}, CODE_TTL_MS).unref()

const router = express.Router()

// ─── Fire-and-forget provisioning tracker ────────────────────────────────────
//
// selfHealProvisioningOnLogin fires runInternalProvision() without awaiting.
// In tests, multiple pending promises can keep Knex/tarn DB connections borrowed
// after the test suite finishes, causing pool.destroy() to hang indefinitely.
//
// We register every promise in this Set and expose drainProvisioningQueue() for
// test teardown so setup.ts can await all in-flight operations before calling
// closeDatabase(). Production code never calls drainProvisioningQueue(), so the
// Set stays small (just the tail of the last login's provisioning).
//
const _pendingProvisioningPromises: Set<Promise<unknown>> = new Set()

/**
 * Wait for all in-flight selfHealProvisioningOnLogin promises to settle.
 * Call this in test afterAll BEFORE closeDatabase() to prevent tarn.js
 * pool.destroy() from hanging on borrowed connections.
 */
export function drainProvisioningQueue(timeoutMs = 10_000): Promise<void> {
  if (_pendingProvisioningPromises.size === 0) return Promise.resolve()
  const pending = Array.from(_pendingProvisioningPromises)
  return Promise.race([
    Promise.allSettled(pending).then(() => undefined),
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
  ])
}

/**
 * Self-heal provisioning on login: ensure the user has a personal org and that
 * every org they own which isn't `active` gets reconciled. Fire-and-forget —
 * this must never block or fail the login response. Acts as the safety net when
 * the identity.user.created Kafka event was lost.
 */
function selfHealProvisioningOnLogin(userId: string): void {
  const p = runInternalProvision(userId).catch(err => {
    console.error(`Login self-heal provisioning failed for ${userId}:`, err)
  })
  _pendingProvisioningPromises.add(p)
  p.finally(() => _pendingProvisioningPromises.delete(p))
}

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
  const requestId = uuidv4().substring(0, 8)
  const startTime = Date.now()

  console.log(`🔐 [${requestId}] Login request received:`, {
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    origin: req.get('Origin'),
    referer: req.get('Referer'),
    contentType: req.get('Content-Type'),
    bodyKeys: Object.keys(req.body || {}),
    hasEmail: !!req.body?.email,
    hasPassword: !!req.body?.password,
    emailDomain: req.body?.email ? req.body.email.split('@')[1] : 'none',
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
    const userRow = await db('users').where('email', email).first()

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
    const isValidPassword = await bcrypt.compare(
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

    // Create the session id first so it can be embedded in the token; this lets
    // logout invalidate only THIS session rather than all of the user's sessions.
    const sessionId = uuidv4()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    // Generate JWT
    const token = jwt.sign(
      { userId: userRow.id, sessionId },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    )

    console.log(`🎫 [${requestId}] JWT token generated:`, {
      tokenLength: token.length,
      tokenPreview: token.substring(0, 20) + '...',
    })

    console.log(`💾 [${requestId}] Creating session:`, {
      sessionId,
      expiresAt: expiresAt.toISOString(),
    })

    await db('sessions').insert({
      id: sessionId,
      user_id: userRow.id,
      expires_at: expiresAt,
    })

    // Debug logging for roles parsing
    console.log(`🔍 [${requestId}] Parsing roles:`, {
      rawRoles: userRow.roles,
      rolesType: typeof userRow.roles,
      rolesLength: userRow.roles?.length,
      firstChar: userRow.roles?.[0],
      fallback: '["user"]',
    })

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

    console.log(`🎉 [${requestId}] Login successful:`, {
      userId: user.id,
      email: user.email,
      roles: user.roles,
      sessionId,
      responseTime: Date.now() - startTime,
    })

    // Self-heal provisioning in the background (does not block the response).
    selfHealProvisioningOnLogin(user.id)

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
router.get('/user', authenticateToken, async (req, res) => {
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
router.post('/logout', authenticateToken, async (req: any, res) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string
        sessionId?: string
      }
      // Invalidate only the current session, not every session the user has.
      if (decoded.sessionId) {
        await db('sessions').where('id', decoded.sessionId).del()
      }
    }

    res.json({ message: 'Logged out successfully' })
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' })
  }
})

/**
 * @swagger
 * /api/auth/oidc/login:
 *   get:
 *     summary: Initiate OIDC login
 *     description: Redirects to Authentik for OIDC authentication
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       302:
 *         description: Redirect to Authentik login page
 *       500:
 *         description: OIDC not configured or server error
 */
router.get('/oidc/login', async (req, res) => {
  const requestId = uuidv4().substring(0, 8)
  console.log(`🔐 [${requestId}] OIDC login request received`)

  try {
    if (!oidcService.isConfigured()) {
      console.log(`❌ [${requestId}] OIDC not configured`)
      return res.status(500).json({
        error: 'OIDC authentication not configured. Please set AUTHENTIK_CLIENT_ID and AUTHENTIK_CLIENT_SECRET.'
      })
    }

    // Lazy re-initialization: if the client failed to init at startup (e.g.
    // Authentik wasn't ready yet), retry now before giving up.
    if (!oidcService.isInitialized()) {
      console.log(`🔄 [${requestId}] OIDC client not initialized — retrying initialization`)
      await oidcService.initialize()
    }

    const state = uuidv4()
    const authUrl = oidcService.generateAuthUrl(state)
    
    console.log(`🔗 [${requestId}] Redirecting to Authentik:`, authUrl)
    res.redirect(authUrl)
  } catch (error) {
    console.error(`❌ [${requestId}] OIDC login error:`, error)
    res.status(500).json({ error: 'Failed to initiate OIDC login' })
  }
})

/**
 * @swagger
 * /api/auth/oidc/password:
 *   post:
 *     summary: Password sign-in against Authentik (no redirect)
 *     description: >
 *       Authenticates email+password by driving Authentik's flow-executor API
 *       server-side, then completes the OIDC code exchange with the resulting
 *       Authentik session. Response shape matches /api/auth/login.
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       200: { description: Authenticated }
 *       400: { description: Missing email or password }
 *       401: { description: Invalid credentials }
 *       503: { description: OIDC unavailable or browser flow required }
 */
router.post('/oidc/password', async (req, res) => {
  const requestId = uuidv4().substring(0, 8)
  const { email, password } = req.body || {}

  console.log('🔐 Authentik password login request', {
    requestId,
    hasEmail: !!email,
    configured: oidcService.isConfigured?.(),
    initialized: oidcService.isInitialized?.(),
  })

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }
  if (!oidcService.isConfigured()) {
    return res.status(503).json({
      error:
        'OIDC authentication not configured. Please set AUTHENTIK_CLIENT_ID and AUTHENTIK_CLIENT_SECRET.',
    })
  }

  try {
    // Lazy re-init mirrors /oidc/login: Authentik may not have been ready at boot.
    if (!oidcService.isInitialized()) {
      await oidcService.initialize()
    }

    const user = await authentikPasswordLogin(email, password)

    const sessionId = uuidv4()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    // nosemgrep: fuze-auth-self-minted-user-token — this IS FuzeFront's identity
    // service; it is the issuer of platform tokens (same mint as /login and the
    // OIDC callback above), not a product self-minting.
    const token = jwt.sign(
      { userId: user.id, sessionId },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    )
    await db('sessions').insert({
      id: sessionId,
      user_id: user.id,
      expires_at: expiresAt,
    })

    selfHealProvisioningOnLogin(user.id)

    console.log('🎉 Authentik password login successful', { requestId, email: user.email })
    return res.json({ token, user, sessionId })
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      console.log('❌ Authentik rejected credentials', { requestId })
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    if (error instanceof UnsupportedFlowStageError) {
      console.warn('⚠️ Unsupported Authentik flow stage', { requestId, message: error.message })
      return res.status(503).json({
        error:
          'This account requires a browser sign-in flow (e.g. MFA). Use the SSO button instead.',
      })
    }
    if (error instanceof AuthentikUnavailableError) {
      console.error('❌ Authentik unavailable', { requestId, message: error.message })
      return res
        .status(503)
        .json({ error: 'Authentication service unavailable. Try again shortly.' })
    }
    console.error('❌ Authentik password login error', { requestId }, error)
    return res.status(500).json({ error: 'Authentication failed' })
  }
})

/**
 * @swagger
 * /api/auth/oidc/callback:
 *   get:
 *     summary: OIDC callback handler
 *     description: Handles the callback from Authentik after successful authentication
 *     tags: [Authentication]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Authorization code from Authentik
 *       - in: query
 *         name: state
 *         required: true
 *         schema:
 *           type: string
 *         description: State parameter for CSRF protection
 *     responses:
 *       302:
 *         description: Redirect to frontend with authentication token
 *       400:
 *         description: Missing code or state parameter
 *       500:
 *         description: Authentication failed
 */
router.get('/oidc/callback', async (req, res) => {
  const requestId = uuidv4().substring(0, 8)
  const { code, state, error } = req.query

  console.log(`🔄 [${requestId}] OIDC callback received:`, {
    hasCode: !!code,
    hasState: !!state,
    error,
  })

  try {
    if (error) {
      const errorDesc = (req.query.error_description as string) || ''
      console.log(`❌ [${requestId}] OIDC error:`, error, errorDesc || '(no description)')
      return res.redirect(
        `${FRONTEND_BASE}/?error=oidc_error&message=${encodeURIComponent(error as string)}${errorDesc ? `&desc=${encodeURIComponent(errorDesc)}` : ''}`
      )
    }

    if (!code || !state) {
      console.log(`❌ [${requestId}] Missing code or state`)
      return res.redirect(`${FRONTEND_BASE}/?error=missing_parameters`)
    }

    // Handle the callback and get user
    const user = await oidcService.handleCallback(code as string, state as string)
    console.log(`✅ [${requestId}] User authenticated via OIDC:`, user.email)

    // Create session id first so it can be embedded in the token
    const sessionId = uuidv4()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    // Generate JWT token — include standard OIDC claims (sub, email) alongside
    // the internal userId/sessionId so consumers can inspect identity claims.
    const token = jwt.sign(
      { userId: user.id, sessionId, sub: user.id, email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    )

    await db('sessions').insert({
      id: sessionId,
      user_id: user.id,
      expires_at: expiresAt,
    })

    console.log(`🎉 [${requestId}] OIDC login successful for:`, user.email)

    // Self-heal provisioning in the background (does not block the redirect).
    selfHealProvisioningOnLogin(user.id)

    // Issue a short-lived opaque exchange code instead of putting the bearer token
    // in the URL (avoids token leakage via referrer headers, server logs, and history).
    const exchangeCode = crypto.randomBytes(32).toString('hex')
    pendingCodes.set(exchangeCode, { token, sessionId, expiresAt: Date.now() + CODE_TTL_MS })
    res.redirect(`${FRONTEND_BASE}/?code=${exchangeCode}`)

  } catch (error) {
    console.error(`❌ [${requestId}] OIDC callback error:`, error)
    res.redirect(`${FRONTEND_BASE}/?error=authentication_failed`)
  }
})

// POST /auth/token-exchange — redeem the single-use exchange code issued by /oidc/callback
router.post('/token-exchange', async (req, res) => {
  const { code } = req.body
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code required' })
  }
  const pending = pendingCodes.get(code)
  if (!pending || Date.now() > pending.expiresAt) {
    pendingCodes.delete(code)
    return res.status(401).json({ error: 'invalid or expired code' })
  }
  pendingCodes.delete(code)
  return res.json({ token: pending.token, sessionId: pending.sessionId })
})

/**
 * @swagger
 * /api/auth/method:
 *   get:
 *     summary: Get available authentication methods
 *     description: Returns which authentication methods are available
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       200:
 *         description: Available authentication methods
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 methods:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["local", "oidc"]
 *                 oidcConfigured:
 *                   type: boolean
 *                 defaultMethod:
 *                   type: string
 */
router.get('/method', (req, res) => {
  const oidcConfigured = oidcService.isConfigured()
  
  const methods = ['local'] // Always support local auth
  if (oidcConfigured) {
    methods.push('oidc')
  }

  res.json({
    methods,
    oidcConfigured,
    defaultMethod: oidcConfigured ? 'oidc' : 'local',
    oidcLoginUrl: oidcConfigured ? '/api/auth/oidc/login' : null,
  })
})

export default router
