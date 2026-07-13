import crypto from 'crypto'
import express from 'express'
import rateLimit from 'express-rate-limit'
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


const CODE_TTL_MS = 60_000
interface PendingCode { token: string; sessionId: string; expiresAt: number }
const pendingCodes = new Map<string, PendingCode>()

// Use the configured frontend base URL for all redirects so that exchange codes
// ride HTTPS in production rather than a hardcoded http:// origin.
const FRONTEND_BASE = (process.env.FRONTEND_URL || 'http://fuzefront.dev.local').replace(/\/$/, '')

// Periodic sweep: remove never-redeemed codes that have passed their TTL.
// .unref() prevents this interval from keeping the process alive in tests.
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of pendingCodes) {
    if (value.expiresAt < now) {
      pendingCodes.delete(key)
    }
  }
}, CODE_TTL_MS).unref()

const router = express.Router()

/**
 * Self-heal provisioning on login: ensure the user has a personal org and that
 * every org they own which isn't `active` gets reconciled. Fire-and-forget —
 * this must never block or fail the login response. Acts as the safety net when
 * the identity.user.created Kafka event was lost.
 */
function selfHealProvisioningOnLogin(userId: string): void {
  runInternalProvision(userId).catch(err => {
    console.error(`Login self-heal provisioning failed for ${userId}:`, err)
  })
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
  // Structured trace: enough to diagnose a broken handoff from pod logs alone
  // (misconfigured issuer/redirect/frontend-base, or an uninitialized client
  // whose discovery against Authentik failed at boot).
  console.log('🔐 OIDC login request received', {
    requestId,
    referer: req.get('Referer'),
    configured: oidcService.isConfigured?.(),
    initialized: oidcService.isInitialized?.(),
    issuerUrl: process.env.AUTHENTIK_ISSUER_URL,
    redirectUri: process.env.AUTHENTIK_REDIRECT_URI,
    frontendBase: FRONTEND_BASE,
  })

  try {
    if (!oidcService.isConfigured()) {
      console.log(`❌ [${requestId}] OIDC not configured`)
      return res.status(500).json({ 
        error: 'OIDC authentication not configured. Please set AUTHENTIK_CLIENT_ID and AUTHENTIK_CLIENT_SECRET.' 
      })
    }

    const state = uuidv4()
    const { url, codeVerifier } = oidcService.generateAuthUrl(state)

    console.log(`🔗 [${requestId}] Redirecting to Authentik:`, url)
    // Persist BOTH the CSRF state and the PKCE code_verifier in HttpOnly cookies
    // so the callback is replica-agnostic (the service runs >1 replica; the
    // callback frequently lands on a different pod than /oidc/login).
    res.setHeader('Set-Cookie', [
      `oidc_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
      `oidc_cv=${codeVerifier}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    ])
    res.redirect(url)
  } catch (error) {
    console.error(`❌ [${requestId}] OIDC login error:`, error)
    res.status(500).json({ error: 'Failed to initiate OIDC login' })
  }
})

/**
 * @swagger
 * /api/auth/oidc/signup:
 *   get:
 *     summary: Initiate account sign-up via Authentik enrollment
 *     description: >
 *       Redirects to Authentik's enrollment flow with the OIDC authorize URL
 *       as the flow's ?next= target, so a freshly-enrolled (and auto-logged-in)
 *       user continues straight through the normal OIDC callback and lands in
 *       the app with a session — no second sign-in step.
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       302:
 *         description: Redirect to the Authentik enrollment flow
 *       500:
 *         description: OIDC not configured or server error
 */
router.get('/oidc/signup', async (req, res) => {
  const requestId = uuidv4().substring(0, 8)
  try {
    if (!oidcService.isConfigured()) {
      console.log(`❌ [${requestId}] OIDC not configured`)
      return res.status(500).json({
        error: 'OIDC authentication not configured. Please set AUTHENTIK_CLIENT_ID and AUTHENTIK_CLIENT_SECRET.',
      })
    }

    const state = uuidv4()
    const { url, codeVerifier } = oidcService.generateAuthUrl(state)
    // Wrap the authorize URL (same Authentik origin) in the enrollment flow's
    // ?next= — Authentik redirects there after the flow's user-login stage.
    const authorize = new URL(url)
    const enrollSlug =
      process.env.AUTHENTIK_ENROLLMENT_FLOW_SLUG || 'fuzefront-enrollment'
    const enrollUrl = `${authorize.origin}/if/flow/${encodeURIComponent(enrollSlug)}/?next=${encodeURIComponent(`${authorize.pathname}${authorize.search}`)}`

    console.log(`🔗 [${requestId}] Redirecting to Authentik enrollment:`, enrollUrl)
    // Same replica-agnostic state/PKCE cookies as /oidc/login — the enrollment
    // flow funnels into the identical authorize → callback exchange.
    res.setHeader('Set-Cookie', [
      `oidc_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=1800; Path=/`,
      `oidc_cv=${codeVerifier}; HttpOnly; Secure; SameSite=Lax; Max-Age=1800; Path=/`,
    ])
    res.redirect(enrollUrl)
  } catch (error) {
    console.error(`❌ [${requestId}] OIDC signup error:`, error)
    res.status(500).json({ error: 'Failed to initiate sign-up' })
  }
})

// Rate limit for the password endpoint: the flow-executor login is a
// credential-stuffing surface, so cap FAILED attempts per client before we
// ever contact Authentik (same express-rate-limit convention as
// tokenAuthRateLimiter). Successful sign-ins are never throttled.
const passwordLoginRateLimiter = rateLimit({
  windowMs: 5 * 60_000,
  limit: 10,
  // Count ONLY rejected credentials (401) against the budget: 503s from an
  // Authentik outage or an MFA-required account must not lock users out.
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again later.' },
})

/**
 * @swagger
 * /api/auth/oidc/password:
 *   post:
 *     summary: Password sign-in against Authentik (no redirect)
 *     description: >
 *       Authenticates email+password by driving Authentik's flow-executor API
 *       server-side, then completes the OIDC code exchange with the resulting
 *       Authentik session. Authentik remains the sole identity authority; the
 *       response shape matches /api/auth/login so the frontend treats both
 *       identically.
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Authenticated — platform JWT + user
 *       400:
 *         description: Missing email or password
 *       401:
 *         description: Invalid credentials
 *       503:
 *         description: OIDC not configured, Authentik unreachable, or the
 *           account requires a browser flow (MFA/consent)
 */
router.post('/oidc/password', passwordLoginRateLimiter, async (req, res) => {
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
    // Lazy re-init mirrors the monolith and /oidc/login: Authentik may not
    // have been ready when this replica booted — self-heal here instead of
    // 503ing until an SSO request happens to re-initialize the client.
    if (!oidcService.isInitialized()) {
      try {
        await oidcService.initialize()
      } catch (initErr) {
        console.error('❌ OIDC lazy init failed', JSON.stringify({ requestId, message: (initErr as Error).message?.replace(/[\r\n]+/g, ' ') }))
        return res
          .status(503)
          .json({ error: 'Authentication service unavailable. Try again shortly.' })
      }
    }

    const user = await authentikPasswordLogin(email, password)

    // Session + JWT minting — identical to the local login / OIDC callback.
    const sessionId = uuidv4()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    // This IS FuzeFront's identity service — the issuer of platform tokens
    // (same mint as /login and the OIDC callback), not a product self-minting.
    // nosemgrep: fuze-auth-self-minted-user-token, semgrep.fuze-auth-self-minted-user-token
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

    console.log('🎉 Authentik password login successful', { requestId, userId: user.id })
    return res.json({ token, user, sessionId })
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      console.log('❌ Authentik rejected credentials', { requestId })
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    if (error instanceof UnsupportedFlowStageError) {
      console.warn('⚠️ Unsupported Authentik flow stage', JSON.stringify({ requestId, message: error.message.replace(/[\r\n]+/g, ' ') }))
      return res.status(503).json({
        error:
          'This account requires a browser sign-in flow (e.g. MFA). Use the SSO button instead.',
      })
    }
    if (error instanceof AuthentikUnavailableError) {
      console.error('❌ Authentik unavailable', JSON.stringify({ requestId, message: error.message.replace(/[\r\n]+/g, ' ') }))
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

  // Helper: clear the state + code_verifier cookies and redirect to the frontend
  // with an error. Called on every failure path so the cookies don't remain
  // valid for their 10-min Max-Age.
  const clearState = (res: import('express').Response) =>
    res.setHeader('Set-Cookie', [
      'oidc_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
      'oidc_cv=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
    ])

  try {
    // CSRF guard: verify state cookie matches query param
    const cookieHeader = req.headers.cookie || ''
    const stateCookieMatch = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('oidc_state='))
    const cookieState = stateCookieMatch ? stateCookieMatch.slice('oidc_state='.length) : null
    const queryState = (req.query.state as string) || ''

    if (!cookieState || cookieState.length !== queryState.length) {
      clearState(res)
      return res.redirect(`${FRONTEND_BASE}/?error=invalid_state`)
    }
    try {
      if (!crypto.timingSafeEqual(Buffer.from(cookieState, 'utf8'), Buffer.from(queryState, 'utf8'))) {
        clearState(res)
        return res.redirect(`${FRONTEND_BASE}/?error=invalid_state`)
      }
    } catch (e) {
      console.warn(`[${requestId}] State comparison error (fail-safe deny):`, e)
      clearState(res)
      return res.redirect(`${FRONTEND_BASE}/?error=invalid_state`)
    }
    // Read the PKCE code_verifier from its cookie (set at /oidc/login) before we
    // clear the cookies on the success path.
    const cvCookieMatch = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('oidc_cv='))
    const codeVerifier = cvCookieMatch ? cvCookieMatch.slice('oidc_cv='.length) : ''

    // Clear both cookies on the success path too
    res.setHeader('Set-Cookie', [
      'oidc_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
      'oidc_cv=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
    ])

    if (error) {
      console.log(`❌ [${requestId}] OIDC error:`, error)
      return res.redirect(`${FRONTEND_BASE}/?error=oidc_error&message=${encodeURIComponent(error as string)}`)
    }

    if (!code || !state) {
      console.log(`❌ [${requestId}] Missing code or state`)
      return res.redirect(`${FRONTEND_BASE}/?error=missing_parameters`)
    }

    if (!codeVerifier) {
      console.log(`❌ [${requestId}] Missing oidc_cv cookie (PKCE verifier)`)
      return res.redirect(`${FRONTEND_BASE}/?error=invalid_state`)
    }

    // Handle the callback and get user (PKCE verifier from the cookie)
    const user = await oidcService.handleCallback(code as string, state as string, codeVerifier)
    console.log(`✅ [${requestId}] User authenticated via OIDC:`, user.email)

    // Create session id first so it can be embedded in the token
    const sessionId = uuidv4()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    // Generate JWT token (includes sessionId so logout can target this session)
    const token = jwt.sign({ userId: user.id, sessionId }, process.env.JWT_SECRET!, {
      expiresIn: '24h',
    })

    await db('sessions').insert({
      id: sessionId,
      user_id: user.id,
      expires_at: expiresAt,
    })

    console.log(`🎉 [${requestId}] OIDC login successful for:`, user.email)

    // Self-heal provisioning in the background (does not block the redirect).
    selfHealProvisioningOnLogin(user.id)

    // Issue a short-lived opaque exchange code instead of putting the bearer token in the URL
    // (avoids token leakage via referrer headers, server logs, and browser history).
    const exchangeCode = crypto.randomBytes(32).toString('hex')
    pendingCodes.set(exchangeCode, { token, sessionId, expiresAt: Date.now() + CODE_TTL_MS })
    res.redirect(`${FRONTEND_BASE}/?code=${exchangeCode}`)

  } catch (error) {
    console.error(`❌ [${requestId}] OIDC callback error:`, error)
    clearState(res)
    res.redirect(`${FRONTEND_BASE}/?error=authentication_failed`)
  }
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

/**
 * @swagger
 * /api/auth/token-exchange:
 *   post:
 *     summary: Exchange OIDC code for token
 *     description: Single-use, 60s TTL exchange of the opaque code issued by /oidc/callback for a JWT token and sessionId
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token and sessionId returned
 *       400:
 *         description: code required
 *       401:
 *         description: invalid or expired code
 */
router.post('/token-exchange', async (req, res) => {
  const { code } = req.body
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code required' })
  }
  const pending = pendingCodes.get(code)
  if (!pending || Date.now() > pending.expiresAt) {
    pendingCodes.delete(code)  // clean up expired entry if present
    return res.status(401).json({ error: 'invalid or expired code' })
  }
  // Single-use: delete immediately
  pendingCodes.delete(code)
  return res.json({ token: pending.token, sessionId: pending.sessionId })
})

export default router
