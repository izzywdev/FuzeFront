import crypto from 'crypto'
import express from 'express'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { mintId, toUuid } from '@izzywdev/fuzefront-identity'
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
import { getRootPortal, getPortalIdentityPolicy } from '../repositories/portalRepository'
import { getRequestPortalsEnabled } from '../utils/portalFlag'
import { getRequestPortalScopingEnabled } from '../utils/identityFlag'
import { checkOrganizationPermission } from '../utils/permit/permission-check'
import { ROOT_ORG_ID } from '../migrations/015_seed_root_platform_organization'
import { isPrefixedIdsEnabled } from '../identity/flags'
import { prefixDtoIds, toWireId } from '../identity/serializer'

const FRONTEND_BASE = (process.env.FRONTEND_URL || 'http://fuzefront.dev.local').replace(/\/$/, '')

// Strips CR/LF before a value reaches a log line (CodeQL js/log-injection —
// an embedded newline could forge additional fake log lines). Mirrors
// middleware/auth.ts's identically-named helper; every value below that
// ultimately traces back to request-controlled input (email, a decoded
// user/portal id) is passed through this before being logged, even where
// it's already been validated/looked up, as defense in depth against
// CodeQL's conservative taint tracking.
const oneLine = (v: unknown) => String(v).replace(/[\r\n]+/g, ' ')

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

// Checks the `organization_memberships` table for an ACTIVE membership row —
// same query shape already used for this exact purpose elsewhere (see
// routes/apps.ts's object-level authorization). Fails CLOSED on a DB error
// (a membership-check failure must never be treated as "is a member").
async function isActiveOrgMember(userId: string, organizationId: string): Promise<boolean> {
  const membership = await db('organization_memberships')
    .where('user_id', userId)
    .where('organization_id', organizationId)
    .where('status', 'active')
    .first()
  return !!membership
}

// The result of resolving a login's portal binding. `ok: false` means the
// login must be REJECTED outright — no token minted, no session created —
// because the authenticating user is not an active member of the resolved
// tenant portal's organization (see the cross-tenant-login fix below), or
// (FF-EPIC-11-S5) because their home_portal_id doesn't match the resolved
// tenant portal and no support-access exception applies. `reason` is a
// stable, machine-readable, LOGGABLE code — never shown verbatim as the only
// thing surfaced to the caller, but always logged server-side (and included
// in the JSON/redirect error) so support/debug can tell the rejection
// classes apart instead of lumping every 403 into one generic bucket.
type PortalRejectionReason =
  | 'NOT_A_MEMBER'
  | 'HOME_PORTAL_MISMATCH'
  | 'SUPPORT_ACCESS_NOT_ALLOWED'

type PortalLoginBinding =
  | { ok: true; portalId?: string; organizationId?: string; portalName?: string }
  | { ok: false; portalName?: string; reason: PortalRejectionReason }

// This repo's tsconfig runs with `strict: false` (no `strictNullChecks`),
// under which plain `if (!portalBinding.ok)` does NOT reliably narrow a
// boolean-discriminated union to its `ok: false` member (verified: TS 5.9
// only narrows this pattern with strictNullChecks on) — so every call site
// below narrows via this explicit type predicate instead of the discriminant
// check inline, exactly so `portalBinding.reason` type-checks.
function isPortalLoginRejected(
  binding: PortalLoginBinding
): binding is Extract<PortalLoginBinding, { ok: false }> {
  return binding.ok === false
}

// Builds the 403 FORBIDDEN_PORTAL JSON body shared by /login and
// /oidc/password (the redirect-based /oidc/callback builds its own query
// string from the same `reason`/`portalName`). Kept in one place so the
// wording for the FF-EPIC-11-S5 home-portal-mismatch case (a CLEAR "account
// not valid for this portal" message, distinct from the plain membership
// rejection's wording) stays consistent across both JSON call sites.
function forbiddenPortalBody(binding: Extract<PortalLoginBinding, { ok: false }>) {
  const name = binding.portalName
  const message =
    binding.reason === 'NOT_A_MEMBER'
      ? name
        ? `This account isn't part of ${name}.`
        : "This account isn't part of this portal."
      : name
        ? `This account is not valid for ${name}.`
        : 'This account is not valid for this portal.'
  return { error: 'FORBIDDEN_PORTAL', reason: binding.reason, message }
}

// FF-EPIC-11-S5 — the authenticating user's home_portal_id (migration 019;
// NULL = root/platform user). A tight, single-purpose lookup (mirrors
// isActiveOrgMember just above) rather than threading the full user row
// through every login site: the Authentik/OIDC call sites (oidc/password,
// oidc/callback) only hand back a `User` DTO that doesn't carry this column
// at all (see services/authentikPassword.ts / services/oidc.ts).
async function getUserHomePortalId(userId: string): Promise<string | null> {
  const row = await db('users').select('home_portal_id').where('id', userId).first()
  return row?.home_portal_id ?? null
}

// FF-EPIC-11-S5 — resolves whether a home-portal-mismatched login should
// nonetheless be ALLOWED as a master-admin support-access login: the caller
// must (a) hold the SAME platform-admin authority `utils/scopeToPortal.ts`'s
// 'bypass' mode and `services/rootOrgAdmin.ts` use (Permit ReBAC `org-admin`
// on the ROOT organization, checked via `checkOrganizationPermission(userId,
// 'manage', ROOT_ORG_ID)` — deliberately not a second authority model), AND
// (b) the RESOLVED tenant portal's own `identity_policy.allowPlatformAdminSupportAccess`
// must be explicitly `true` (fail CLOSED on missing/malformed identity_policy
// — `getPortalIdentityPolicy` never treats a broken column as permissive).
// A platform admin is NOT enough on its own: a portal must opt in. On
// success this AUDIT-LOGS the access (constant format string + oneLine() —
// same CodeQL js/log-injection/js/unsafe-formatstring convention as the
// rest of this file) so it's distinguishable from a normal tenant login.
async function resolveSupportAccessDecision(
  userId: string,
  portal: { id: string; organization_id: string; identity_policy?: unknown }
): Promise<{ allowed: boolean; isPlatformAdmin: boolean }> {
  let isPlatformAdmin = false
  try {
    isPlatformAdmin = await checkOrganizationPermission(userId, 'manage', ROOT_ORG_ID)
  } catch {
    // Fail-safe: a Permit error denies support access (falls through to the
    // ordinary HOME_PORTAL_MISMATCH rejection below), never grants it.
    isPlatformAdmin = false
  }
  if (!isPlatformAdmin) return { allowed: false, isPlatformAdmin: false }

  const identityPolicy = getPortalIdentityPolicy(portal)
  if (identityPolicy.allowPlatformAdminSupportAccess !== true) {
    return { allowed: false, isPlatformAdmin: true }
  }

  console.log(
    '🛡️ [SUPPORT-ACCESS] Platform admin authenticated into tenant portal via identity_policy.allowPlatformAdminSupportAccess: userId=%s portalId=%s organizationId=%s',
    oneLine(userId),
    oneLine(portal.id),
    oneLine(portal.organization_id)
  )
  return { allowed: true, isPlatformAdmin: true }
}

// ─── FF-EPIC-10-S3 — JWT/session portal binding ──────────────────────────────
//
// Resolves the portal a freshly-minted token/session should be bound to: the
// Host-resolved portal (req.portal, set by the global resolvePortalContext
// middleware) if present, else the seeded root portal. Resolves to `{ok:
// true}` (no-op) when the master flag is OFF, so token payload / session
// columns are byte-for-byte unchanged from pre-epic behavior.
//
// Root cause A fix (gate-code-review round 4) — reuses
// getRequestPortalsEnabled (utils/portalFlag.ts), the ONE shared helper every
// request-path consumer must go through, instead of re-implementing its own
// copy of the "read req.portalsFlagEnabled, else fall back" ternary. Two
// independent evaluations of a per-user-targeted flag can legitimately
// disagree (this exact function regressed once already after
// authenticateToken was fixed in isolation — see utils/portalFlag.ts's
// doc-comment on why this can no longer happen per-callsite).
async function resolvePortalBindingForLogin(
  req: express.Request,
  userId: string
): Promise<PortalLoginBinding> {
  const enabled = await getRequestPortalsEnabled(req)
  if (!enabled) return { ok: true }

  const resolved = req.portal
  if (resolved) {
    // Do NOT rebind sessions.active_organization_id to the ROOT/platform
    // portal's org for a root-portal / main-domain login. A regular user
    // logging in on the main app host is very likely NOT a member of the
    // platform org; force-setting active_organization_id there would
    // silently rebind the session's active org on EVERY main-domain login
    // once the flag is ON — violating "flag-off/main-domain behavior is
    // byte-for-byte unchanged." `portalId` is still bound for the root
    // portal (a legitimate, non-tenant-specific binding, consistent with
    // authenticateToken's legacy-token policy); only `organizationId` is
    // withheld for root. No membership check applies to root — it isn't a
    // tenant org.
    if (resolved.is_root) {
      return { ok: true, portalId: resolved.id }
    }
    // Cross-tenant login authorization fix — a tenant-host login only
    // verified GLOBAL user credentials (any valid FuzeFront account can log
    // in); it never checked the user is a member of the RESOLVED portal's
    // org. Without this check, user A (a member of org X only) POSTing
    // valid credentials to tenant B's Host would have their session's
    // active org silently set to B's org and their token bound to portal
    // B — scoping every later request to an org they don't belong to. Same
    // silent-rebind class already closed for the root portal above, not
    // previously applied to tenant portals. Fail CLOSED: reject the login
    // outright (no token minted, no session created) rather than bind an
    // unverified membership.
    const isMember = await isActiveOrgMember(userId, resolved.organization_id).catch(() => false)

    // ─── FF-EPIC-11-S5 — home_portal_id-based cross-portal login rejection ──
    //
    // Layered ONTO the membership check above, not a replacement for it —
    // and gated by its OWN flag (`fuzefront.identity.portal-scoped-users`,
    // the SAME one every other portal-scoped-identity enforcement path uses
    // — see utils/identityFlag.ts), independently of the multi-tenant-portals
    // flag already gating everything above. OFF ⇒ today's behavior: only the
    // membership check applies (unchanged since #424).
    //
    // Membership alone is not a sufficient cross-portal guard: a user can
    // legitimately hold an active `organization_memberships` row on more than
    // one org (e.g. a consultant added to several client orgs) while still
    // having exactly ONE home portal. Without this check, that user's
    // credentials would silently authenticate them into every portal whose
    // org they happen to be a member of, not just their home. `home_portal_id
    // === resolved.id` is the authoritative match; anything else — including
    // a root-homed account (`home_portal_id === null`, which trivially never
    // equals a non-root `resolved.id`) — is a cross-portal login and gets NO
    // implicit bypass. The one exception is the master-admin support-access
    // path resolved below, which requires BOTH Permit platform-admin
    // authority AND this portal's own explicit identity_policy opt-in.
    const scopingEnabled = await getRequestPortalScopingEnabled(req)
    if (scopingEnabled) {
      const homePortalId = await getUserHomePortalId(userId)
      if (homePortalId !== resolved.id) {
        const support = await resolveSupportAccessDecision(userId, resolved)
        if (support.allowed) {
          return {
            ok: true,
            portalId: resolved.id,
            organizationId: resolved.organization_id,
          }
        }
        return {
          ok: false,
          portalName: resolved.name ?? resolved.slug,
          reason: support.isPlatformAdmin ? 'SUPPORT_ACCESS_NOT_ALLOWED' : 'HOME_PORTAL_MISMATCH',
        }
      }
    }

    if (!isMember) {
      return { ok: false, portalName: resolved.name ?? resolved.slug, reason: 'NOT_A_MEMBER' }
    }
    return {
      ok: true,
      portalId: resolved.id,
      organizationId: resolved.organization_id,
    }
  }
  // Only reached when nothing resolved for this request (bootstrap mode, or
  // resolvePortalContext didn't run upstream). `.catch()` so a portals-table
  // hiccup degrades to "no portal bound" rather than breaking login itself.
  // The fallback is always the ROOT portal, so — same reasoning as above —
  // organizationId is never set here either, and no membership check applies.
  const root = await getRootPortal(db).catch(() => undefined)
  if (!root) return { ok: true }
  return { ok: true, portalId: root.id }
}

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

  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' })
  }

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

    // FF-EPIC-10-S3 — {ok:true} no-op when the multi-tenant-portals flag is
    // OFF. Resolved BEFORE minting anything: a tenant-host login where the
    // user isn't an active member of that portal's org is rejected outright
    // (fail closed) — no session id, no token, no session row.
    const portalBinding = await resolvePortalBindingForLogin(req, userRow.id)
    if (isPortalLoginRejected(portalBinding)) {
      // Constant format string + %s (Semgrep js/unsafe-formatstring) — a
      // template literal used as the format string with a trailing arg is
      // flagged even though `requestId` is server-generated here; keep the
      // same established pattern as the rest of this file's sanitized logs.
      // `reason` (FF-EPIC-11-S5) is a fixed, server-computed enum value —
      // included so support/debug can tell a plain membership rejection
      // apart from a home_portal_id mismatch or a denied support-access
      // attempt, instead of one generic "login rejected" bucket.
      console.log(
        '❌ [%s] Login rejected — reason=%s:',
        requestId,
        portalBinding.reason,
        {
          userId: userRow.id,
          responseTime: Date.now() - startTime,
        }
      )
      return res.status(403).json(forbiddenPortalBody(portalBinding))
    }

    // Create the session id first so it can be embedded in the token; this lets
    // logout invalidate only THIS session rather than all of the user's sessions.
    const sessionId = toUuid(mintId('session'))
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    // Generate JWT
    const token = jwt.sign(
      {
        userId: userRow.id,
        sessionId,
        ...(portalBinding.portalId ? { portalId: portalBinding.portalId } : {}),
      },
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
      ...(portalBinding.organizationId
        ? { active_organization_id: portalBinding.organizationId }
        : {}),
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

    const flagCtx = { userId: user.id }
    const prefixed = await isPrefixedIdsEnabled(flagCtx)
    res.json({
      token,
      user: prefixDtoIds(user, prefixed, { id: 'user', defaultAppId: 'app' }),
      sessionId: toWireId('session', sessionId, prefixed),
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
router.get('/user', authenticateToken, async (req: any, res) => {
  const flagCtx = { userId: req.user?.id }
  const prefixed = await isPrefixedIdsEnabled(flagCtx)
  res.json({
    user: prefixDtoIds(req.user, prefixed, { id: 'user', defaultAppId: 'app', portalId: 'portal', homePortalId: 'portal' }),
  })
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
// Unauthenticated redirect endpoint — cheap, but cap per-client abuse anyway
// (URL-minting/log-noise). Generous: legitimate users click this once or twice.
const signupRedirectRateLimiter = rateLimit({
  windowMs: 5 * 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-up attempts. Try again later.' },
})

router.get('/oidc/signup', signupRedirectRateLimiter, async (req, res) => {
  const requestId = uuidv4().substring(0, 8)
  console.log('📝 OIDC signup request received', { requestId })

  try {
    if (!oidcService.isConfigured()) {
      console.log('❌ OIDC not configured (signup)', { requestId })
      return res.status(500).json({
        error: 'OIDC authentication not configured. Please set AUTHENTIK_CLIENT_ID and AUTHENTIK_CLIENT_SECRET.'
      })
    }

    // Lazy re-initialization, mirroring /oidc/login.
    if (!oidcService.isInitialized()) {
      console.log('🔄 OIDC client not initialized — retrying initialization', { requestId })
      await oidcService.initialize()
    }

    const state = uuidv4()
    const authUrl = oidcService.generateAuthUrl(state)
    // Wrap the authorize URL (same Authentik origin) in the enrollment flow's
    // ?next= — Authentik redirects there after the flow's user-login stage.
    const authorize = new URL(authUrl)
    const enrollSlug =
      process.env.AUTHENTIK_ENROLLMENT_FLOW_SLUG || 'fuzefront-enrollment'
    const enrollUrl = `${authorize.origin}/if/flow/${encodeURIComponent(enrollSlug)}/?next=${encodeURIComponent(`${authorize.pathname}${authorize.search}`)}`

    console.log('🔗 Redirecting to Authentik enrollment', { requestId, enrollUrl })
    res.redirect(enrollUrl)
  } catch (error) {
    console.error('❌ OIDC signup error', { requestId }, error)
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
 *       Authentik session. Response shape matches /api/auth/login.
 *     tags: [Authentication]
 *     security: []
 *     responses:
 *       200: { description: Authenticated }
 *       400: { description: Missing email or password }
 *       401: { description: Invalid credentials }
 *       503: { description: OIDC unavailable or browser flow required }
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
    // Lazy re-init mirrors /oidc/login: Authentik may not have been ready at boot.
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

    // FF-EPIC-10-S3 — {ok:true} no-op when the multi-tenant-portals flag is
    // OFF. Resolved BEFORE minting anything: a tenant-host login where the
    // user isn't an active member of that portal's org is rejected outright.
    const portalBinding = await resolvePortalBindingForLogin(req, user.id)
    if (isPortalLoginRejected(portalBinding)) {
      // reason (FF-EPIC-11-S5) — see /login's identical log-line comment above.
      console.log('❌ Authentik login rejected — reason=%s', portalBinding.reason, {
        requestId,
        userId: user.id,
      })
      return res.status(403).json(forbiddenPortalBody(portalBinding))
    }

    const sessionId = toUuid(mintId('session'))
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    // This IS FuzeFront's identity service — the issuer of platform tokens
    // (same mint as /login and the OIDC callback), not a product self-minting.
    // nosemgrep: fuze-auth-self-minted-user-token, semgrep.fuze-auth-self-minted-user-token
    const token = jwt.sign(
      {
        userId: user.id,
        sessionId,
        ...(portalBinding.portalId ? { portalId: portalBinding.portalId } : {}),
      },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    )
    await db('sessions').insert({
      id: sessionId,
      user_id: user.id,
      expires_at: expiresAt,
      ...(portalBinding.organizationId
        ? { active_organization_id: portalBinding.organizationId }
        : {}),
    })

    selfHealProvisioningOnLogin(user.id)

    const flagCtx = { userId: user.id }
    const prefixed = await isPrefixedIdsEnabled(flagCtx)
    console.log('🎉 Authentik password login successful', { requestId, userId: user.id })
    return res.json({
      token,
      user: prefixDtoIds(user, prefixed, { id: 'user', defaultAppId: 'app' }),
      sessionId: toWireId('session', sessionId, prefixed),
    })
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

    // FF-EPIC-10-S3 — {ok:true} no-op when the multi-tenant-portals flag is
    // OFF. Resolved BEFORE minting anything: a tenant-host login where the
    // user isn't an active member of that portal's org is rejected outright
    // — redirected back with an error query param, matching this route's
    // existing error-handling convention (missing_parameters, oidc_error, ...).
    const portalBinding = await resolvePortalBindingForLogin(req, user.id)
    if (isPortalLoginRejected(portalBinding)) {
      // user.email comes from the OIDC identity provider's response — strip
      // CR/LF before logging (same convention as this file's existing OIDC
      // error logs a few lines up) so it can't forge additional log lines.
      // reason (FF-EPIC-11-S5) — see /login's identical log-line comment above.
      console.log(
        '❌ [%s] OIDC login rejected — reason=%s: %s',
        requestId,
        portalBinding.reason,
        oneLine(user.email)
      )
      return res.redirect(
        `${FRONTEND_BASE}/?error=forbidden_portal&reason=${encodeURIComponent(portalBinding.reason)}`
      )
    }

    // Create session id first so it can be embedded in the token
    const sessionId = toUuid(mintId('session'))
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    // Generate JWT token — include standard OIDC claims (sub, email) alongside
    // the internal userId/sessionId so consumers can inspect identity claims.
    const token = jwt.sign(
      {
        userId: user.id,
        sessionId,
        sub: user.id,
        email: user.email,
        ...(portalBinding.portalId ? { portalId: portalBinding.portalId } : {}),
      },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    )

    await db('sessions').insert({
      id: sessionId,
      user_id: user.id,
      expires_at: expiresAt,
      ...(portalBinding.organizationId
        ? { active_organization_id: portalBinding.organizationId }
        : {}),
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
  const prefixed = await isPrefixedIdsEnabled()
  return res.json({ token: pending.token, sessionId: toWireId('session', pending.sessionId, prefixed) })
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
