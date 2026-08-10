// The legacy app registry — /api/apps. See deploy/route-ownership.json: the
// ingress routes `/api/apps` (longest-prefix) to fuzefront-applications, so
// THIS file (not backend/src/routes/apps.ts, which is unmounted dead code —
// see its removal commit) is the one and only implementation.
//
// SECURITY NOTE (appsec #100, ported here from the dead backend copy)
// ---------------------------------------------------------------------------
// backend/src/routes/apps.ts received a BOLA/auth fix (CRITICAL-1, CRITICAL-2,
// HIGH-3, HIGH-4, MEDIUM-5 — commit 87b1fbae) that never reached this service,
// because this router — not that one — is what /api/apps actually resolves to
// in every deployed environment. The fix therefore never protected a single
// real request. It is ported below, gated behind the
// `fuzefront.apps-registry.object-level-authz` release flag (default OFF —
// see app-registry/flags.ts for the full rationale): flipping it OFF is exact
// parity with this file's pre-fix behavior; ON applies the fix. See that flag's
// doc comment before enabling it — clock-app / task-manager-app call
// POST /register ANONYMOUSLY today and need to be accounted for first.
import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { App } from '../types/shared'
import { authenticateToken, requireRole } from '../middleware/auth'
import { getMemberOrgIds } from '../app-registry/caller'
import { getPermitClient } from '../app-registry/permit'
import { isLegacyObjectLevelAuthzEnabled } from '../app-registry/flags'

const router = express.Router()

// Database row interface for apps
interface AppRow {
  id: string
  name: string
  url: string
  icon_url: string
  is_active: boolean
  integration_type: 'iframe' | 'module-federation' | 'web-component' | 'spa'
  remote_url: string
  scope: string
  module: string
  description: string
  metadata: string
  organization_id: string | null
  visibility: 'private' | 'organization' | 'public' | 'marketplace'
  // Where the app may be INSTALLED (backend migration 017). Distinct from
  // `scope` above, which is the Module-Federation remote container name.
  scope_level: 'personal' | 'organization' | 'both'
  created_at: Date
  updated_at: Date
}

// Install scope levels an app may declare. Rows written before migration 017
// read as the column default, 'both'.
const VALID_SCOPE_LEVELS = ['personal', 'organization', 'both'] as const

const VALID_INTEGRATION_TYPES = [
  'iframe',
  'module-federation',
  'web-component',
  'spa',
] as const

const VALID_HEARTBEAT_STATUSES = ['online', 'offline', 'degraded'] as const

// ---------------------------------------------------------------------------
// appsec #100 authorization helpers (object-level, org-scoped) — active only
// when fuzefront.apps-registry.object-level-authz is ON. Ported verbatim from
// backend/src/routes/apps.ts's requireAppAction/loadAppForUser/scopeAppsQuery
// (`apps.organization_id`, migration 006, is the ownership anchor).
// ---------------------------------------------------------------------------

interface AppAuthzResult {
  app: AppRow | undefined
  membershipRole: string | null
}

async function loadAppForUser(
  appId: string,
  userId: string
): Promise<AppAuthzResult> {
  const app = (await db('apps').where('id', appId).first()) as
    | AppRow
    | undefined

  if (!app) {
    return { app: undefined, membershipRole: null }
  }

  if (!app.organization_id) {
    // Legacy / un-owned app: no org to scope to. Treat as not-entitled for
    // mutations (fail closed); only platform-role callers may act on it.
    return { app, membershipRole: null }
  }

  const membership = await db('organization_memberships')
    .where('user_id', userId)
    .where('organization_id', app.organization_id)
    .where('status', 'active')
    .first()

  return { app, membershipRole: membership ? membership.role : null }
}

/** Mirrors backend/src/utils/permit/permission-check.ts's checkAppPermission,
 * reusing THIS service's own Permit client (app-registry/permit.ts) rather
 * than importing across the workspace boundary. Fails CLOSED on any error. */
async function checkAppPermission(
  userId: string,
  action: 'create' | 'update' | 'delete',
  appId: string | undefined,
  organizationId: string
): Promise<boolean> {
  try {
    return await getPermitClient().check(userId, action, {
      type: 'App',
      tenant: organizationId,
      key: appId,
    })
  } catch (err) {
    console.error(
      `[apps][permit] check failed (deny) user=${userId} action=${action}:`,
      err instanceof Error ? err.message : String(err)
    )
    return false
  }
}

/** The caller's personal organization, used to bind ownership on self-register
 * (POST /register) when no explicit org context is provided. */
async function resolvePersonalOrgId(userId: string): Promise<string | null> {
  const org = await db('organizations')
    .where({ owner_id: userId, type: 'personal' })
    .first()
  return org ? org.id : null
}

/**
 * Object-level authorization middleware for app mutations (PUT
 * /:id/activate, DELETE /:id, POST /:id/heartbeat).
 *
 * OFF (flag default): exact pre-fix parity — a bare platform `admin` role
 * check, matching the `requireRole(['admin'])` this router shipped with.
 * ON: owner/admin member of the app's owning org (object-level), OR a Permit
 * App:<action> check for org members who aren't owner/admin, OR a platform
 * admin for legacy un-owned apps. Fails closed (403/404) otherwise.
 */
function requireAppAction(action: 'update' | 'delete') {
  return async (req: any, res: express.Response, next: express.NextFunction) => {
    try {
      if (!req.user?.id) {
        return res
          .status(401)
          .json({ error: 'Authentication required', code: 'AUTH_REQUIRED' })
      }

      // Reuse conditionalAuth's decision when this middleware runs downstream
      // of it (POST /:id/heartbeat) so one request never observes two
      // different flag reads; evaluate fresh otherwise (PUT/DELETE, where
      // authenticateToken — not conditionalAuth — runs first).
      const enabled =
        typeof req.appsRegistryAuthzEnabled === 'boolean'
          ? req.appsRegistryAuthzEnabled
          : await isLegacyObjectLevelAuthzEnabled({ userId: req.user.id })

      if (!enabled) {
        const roles: string[] = req.user.roles || []
        if (!roles.includes('admin')) {
          return res.status(403).json({ error: 'Insufficient permissions' })
        }
        return next()
      }

      const { id } = req.params
      const { app, membershipRole } = await loadAppForUser(id, req.user.id)

      if (!app) {
        return res
          .status(404)
          .json({ error: 'App not found', code: 'APP_NOT_FOUND' })
      }

      // Object-level: owner/admin of the app's owning org may act on it.
      if (membershipRole === 'owner' || membershipRole === 'admin') {
        req.app_row = app
        return next()
      }

      // Policy layer: only consult Permit for org members who aren't
      // owner/admin. Non-members are denied fail-closed without a Permit
      // round-trip (no Permit PDP dependency for membership-table authz).
      if (app.organization_id && membershipRole !== null) {
        const permitted = await checkAppPermission(
          req.user.id,
          action,
          app.id,
          app.organization_id
        )
        if (permitted) {
          req.app_row = app
          return next()
        }
      } else if (!app.organization_id) {
        // Un-owned legacy app: only a platform admin may touch it.
        const roles: string[] = req.user.roles || []
        if (roles.includes('admin')) {
          req.app_row = app
          return next()
        }
      }

      return res.status(403).json({
        error: 'Insufficient permissions to modify this app',
        code: 'APP_PERMISSION_DENIED',
      })
    } catch (error) {
      console.error('App authorization error:', error)
      return res
        .status(500)
        .json({ error: 'Authorization check failed', code: 'AUTHZ_ERROR' })
    }
  }
}

/**
 * Conditionally requires a valid session, ONLY when the flag is ON — the flag
 * default (OFF) is exact parity with this route's pre-fix, always-open
 * behavior. Stashes the decision on the request so the handler doesn't
 * re-evaluate the flag a second time.
 */
function conditionalAuth(
  req: any,
  res: express.Response,
  next: express.NextFunction
) {
  isLegacyObjectLevelAuthzEnabled()
    .then(enabled => {
      req.appsRegistryAuthzEnabled = enabled
      if (!enabled) {
        next()
        return
      }
      void authenticateToken(req, res, next)
    })
    .catch(() => {
      req.appsRegistryAuthzEnabled = false
      next()
    })
}

/**
 * Build the SET of organization IDs the caller may see apps from (their active
 * memberships). Used to scope collection reads (HIGH-4).
 */
// getMemberOrgIds is imported from ../app-registry/caller (shared with
// app-installations.ts / app-registry.ts rather than re-declared here).

/**
 * Apply org/visibility scoping to an apps query for the given user.
 * The caller may see an app when ANY of:
 *   - it belongs to an org they're an active member of, OR
 *   - its visibility is 'public' or 'marketplace'.
 * Private/organization apps of orgs they don't belong to are excluded (BOLA).
 */
function scopeAppsQuery(query: any, memberOrgIds: string[]) {
  return query.where(function (this: any) {
    this.whereIn('apps.visibility', ['public', 'marketplace'])
    if (memberOrgIds.length > 0) {
      this.orWhereIn('apps.organization_id', memberOrgIds)
    }
  })
}

// Health check function for individual apps
async function checkAppHealth(app: AppRow): Promise<boolean> {
  try {
    const healthUrl = `${app.url}` // Check root URL instead of /healthy
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/json',
      },
    })

    clearTimeout(timeoutId)
    // Accept any response (including 404) as long as the server responds
    return response.status < 500 // Consider 2xx, 3xx, 4xx as healthy, 5xx as unhealthy
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    console.log(
      `Health check failed for ${app.name} (${app.url}):`,
      errorMessage
    )
    return false
  }
}

// GET /api/apps/health - Check health of registered apps
router.get('/health', authenticateToken, async (req: any, res) => {
  try {
    const enabled = await isLegacyObjectLevelAuthzEnabled({
      userId: req.user.id,
    })

    let query = db('apps').where('is_active', true)
    if (enabled) {
      // HIGH-4: scope to the caller's orgs + public/marketplace visibility
      // instead of returning every active app on the platform.
      const memberOrgIds = await getMemberOrgIds(req.user.id)
      query = scopeAppsQuery(query, memberOrgIds)
    }
    const apps = await query.orderBy('name')

    const healthChecks = await Promise.all(
      apps.map(async (app: AppRow) => {
        const isHealthy = await checkAppHealth(app)
        return {
          id: app.id,
          name: app.name,
          url: app.url,
          isHealthy,
          lastChecked: new Date().toISOString(),
        }
      })
    )

    res.json(healthChecks)
  } catch (error) {
    console.error('Error checking app health:', error)
    res.status(500).json({ error: 'Failed to check app health' })
  }
})

/**
 * @swagger
 * /api/apps:
 *   get:
 *     summary: Get registered applications
 *     description: >-
 *       Retrieve applications with their health status. When the
 *       object-level-authz release flag is ON, scoped to the caller's
 *       organization memberships plus public/marketplace visibility.
 *     tags: [Applications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: healthyOnly
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *         description: If 'true', only return healthy applications
 *         example: 'false'
 *     responses:
 *       200:
 *         description: List of applications
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/App'
 *       500:
 *         description: Failed to fetch applications
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// GET /api/apps - Get registered apps with health status
router.get('/', authenticateToken, async (req: any, res) => {
  try {
    const { healthyOnly } = req.query

    const enabled = await isLegacyObjectLevelAuthzEnabled({
      userId: req.user.id,
    })

    let query = db('apps').where('is_active', true)
    if (enabled) {
      // HIGH-4: object-level read scoping (org membership + visibility).
      const memberOrgIds = await getMemberOrgIds(req.user.id)
      query = scopeAppsQuery(query, memberOrgIds)
    }
    const apps = await query.orderBy('name')

    // Get health status for all apps
    const appsWithHealth = await Promise.all(
      apps.map(async (app: AppRow) => {
        const isHealthy = await checkAppHealth(app)
        return {
          id: app.id,
          name: app.name,
          url: app.url,
          iconUrl: app.icon_url,
          isActive: Boolean(app.is_active),
          isHealthy: isHealthy,
          integrationType: app.integration_type as
            | 'module-federation'
            | 'iframe'
            | 'web-component'
            | 'spa',
          remoteUrl: app.remote_url,
          scope: app.scope,
          module: app.module,
          description: app.description,
          scopeLevel: app.scope_level ?? 'both',
        }
      })
    )

    // If healthyOnly is requested, filter by health status
    if (healthyOnly === 'true') {
      const healthyApps = appsWithHealth.filter((app: any) => app.isHealthy)
      res.json(
        healthyApps.map((app: any) => {
          const { isHealthy, ...appWithoutHealth } = app
          return appWithoutHealth
        })
      )
    } else {
      res.json(appsWithHealth)
    }
  } catch (error) {
    console.error('Error fetching apps:', error)
    res.status(500).json({ error: 'Failed to fetch apps' })
  }
})

/**
 * @swagger
 * /api/apps:
 *   post:
 *     summary: Register new application
 *     description: Register a new microfrontend application (admin only)
 *     tags: [Applications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAppRequest'
 *           examples:
 *             module-federation:
 *               summary: Module Federation App
 *               value:
 *                 name: "My React App"
 *                 url: "https://my-app.netlify.app"
 *                 iconUrl: "https://my-app.netlify.app/icon.svg"
 *                 integrationType: "module-federation"
 *                 remoteUrl: "https://my-app.netlify.app/assets/remoteEntry.js"
 *                 scope: "myApp"
 *                 module: "./App"
 *                 description: "A React microfrontend application"
 *             iframe:
 *               summary: Iframe App
 *               value:
 *                 name: "External Dashboard"
 *                 url: "https://dashboard.example.com"
 *                 iconUrl: "https://dashboard.example.com/favicon.ico"
 *                 integrationType: "iframe"
 *                 description: "External dashboard embedded via iframe"
 *     responses:
 *       201:
 *         description: Application registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/App'
 *       400:
 *         description: Bad request - missing required fields or duplicate name
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to create application
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// POST /api/apps - Register new app (admin only)
router.post(
  '/',
  authenticateToken,
  requireRole(['admin']),
  async (req: any, res) => {
    try {
      let {
        name,
        url,
        iconUrl,
        integrationType = 'iframe',
        remoteUrl,
        scope,
        module,
        description,
        scopeLevel = 'both',
      } = req.body

      // Input sanitization - trim whitespace from string fields
      if (typeof name === 'string') name = name.trim()
      if (typeof url === 'string') url = url.trim()
      if (typeof iconUrl === 'string') iconUrl = iconUrl.trim()
      if (typeof integrationType === 'string')
        integrationType = integrationType.trim()
      if (typeof remoteUrl === 'string') remoteUrl = remoteUrl.trim()
      if (typeof scope === 'string') scope = scope.trim()
      if (typeof module === 'string') module = module.trim()
      if (typeof description === 'string') description = description.trim()
      if (typeof scopeLevel === 'string') scopeLevel = scopeLevel.trim()

      // Basic required field validation
      if (!name || name.length === 0) {
        return res
          .status(400)
          .json({ error: 'Name is required and cannot be empty' })
      }

      if (!url || url.length === 0) {
        return res
          .status(400)
          .json({ error: 'URL is required and cannot be empty' })
      }

      // Length validation
      if (name.length > 255) {
        return res
          .status(400)
          .json({ error: 'App name is too long (maximum 255 characters)' })
      }

      if (url.length > 255) {
        return res
          .status(400)
          .json({ error: 'URL is too long (maximum 255 characters)' })
      }

      // URL format validation
      const urlRegex = /^https?:\/\/.+/i
      if (!urlRegex.test(url)) {
        return res
          .status(400)
          .json({ error: 'URL must be a valid HTTP or HTTPS URL' })
      }

      // Icon URL validation (if provided)
      if (iconUrl && iconUrl.length > 0) {
        if (iconUrl.length > 255) {
          return res
            .status(400)
            .json({ error: 'Icon URL is too long (maximum 255 characters)' })
        }
        if (!urlRegex.test(iconUrl)) {
          return res
            .status(400)
            .json({ error: 'Icon URL must be a valid HTTP or HTTPS URL' })
        }
      }

      // Install scope level validation. Declares where the app may be
      // installed (personal space, an organization, or either); the install
      // flow asks the user only about the choices this leaves open.
      if (!VALID_SCOPE_LEVELS.includes(scopeLevel)) {
        return res.status(400).json({
          error: `Invalid scopeLevel. Must be one of: ${VALID_SCOPE_LEVELS.join(', ')}`,
        })
      }

      // Integration type validation
      if (!VALID_INTEGRATION_TYPES.includes(integrationType)) {
        return res.status(400).json({
          error: `Invalid integration type. Must be one of: ${VALID_INTEGRATION_TYPES.join(', ')}`,
        })
      }

      // Module federation specific validation
      if (integrationType === 'module-federation') {
        if (!remoteUrl || remoteUrl.length === 0) {
          return res.status(400).json({
            error: 'remoteUrl is required for module federation applications',
          })
        }

        if (remoteUrl.length > 255) {
          return res
            .status(400)
            .json({ error: 'remoteUrl is too long (maximum 255 characters)' })
        }

        if (!scope || scope.length === 0) {
          return res.status(400).json({
            error: 'scope is required for module federation applications',
          })
        }

        if (scope.length > 255) {
          return res
            .status(400)
            .json({ error: 'scope is too long (maximum 255 characters)' })
        }

        if (!module || module.length === 0) {
          return res.status(400).json({
            error: 'module is required for module federation applications',
          })
        }

        if (module.length > 255) {
          return res
            .status(400)
            .json({ error: 'module is too long (maximum 255 characters)' })
        }

        // Validate remoteUrl format
        if (!urlRegex.test(remoteUrl)) {
          return res.status(400).json({
            error: 'remoteUrl must be a valid HTTP or HTTPS URL',
          })
        }
      }

      // Check for duplicate app name
      const existingApp = await db('apps').where('name', name).first()
      if (existingApp) {
        return res
          .status(409)
          .json({ error: 'An app with this name already exists' })
      }

      const appId = uuidv4()

      // MEDIUM-5: only an explicit allow-list of columns is written; never the
      // raw req.body. Unknown/extra fields in the body are silently dropped.
      await db('apps').insert({
        id: appId,
        name,
        url,
        icon_url: iconUrl,
        integration_type: integrationType,
        remote_url: remoteUrl,
        scope,
        module,
        description,
        scope_level: scopeLevel,
      })

      const newApp: App = {
        id: appId,
        name,
        url,
        iconUrl,
        isActive: true,
        integrationType,
        remoteUrl,
        scope,
        module,
        description,
        visibility: 'private',
        marketplaceMetadata: {},
        isMarketplaceApproved: false,
        installCount: 0,
        scopeLevel,
      }

      res.status(201).json(newApp)
    } catch (error: any) {
      console.error('Error creating app:', error)

      // Check if it's a unique constraint violation (fallback)
      if (
        error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        error.message?.includes('UNIQUE constraint failed')
      ) {
        return res
          .status(409)
          .json({ error: 'An app with this name already exists' })
      }

      res.status(500).json({ error: 'Failed to create app' })
    }
  }
)

// PUT /api/apps/:id/activate - Activate/deactivate app
//
// HIGH-3 + MEDIUM-5 (gated, see requireAppAction doc): object-level authz
// (owner/admin of the app's org, or a Permit App:update) replaces the bare
// global requireRole(['admin']) when the flag is ON; and only the boolean
// `is_active` (coerced) is written from the body, never raw fields.
router.put(
  '/:id/activate',
  authenticateToken,
  requireAppAction('update'),
  async (req: any, res) => {
    try {
      const { id } = req.params
      const { isActive } = req.body

      if (typeof isActive !== 'boolean') {
        return res
          .status(400)
          .json({ error: 'isActive is required and must be a boolean' })
      }

      await db('apps').where('id', id).update({
        is_active: isActive,
        updated_at: db.fn.now(),
      })

      res.json({ message: 'App status updated successfully' })
    } catch (error) {
      console.error('Error updating app status:', error)
      res.status(500).json({ error: 'Failed to update app status' })
    }
  }
)

// DELETE /api/apps/:id - Deregister app
//
// HIGH-3 (gated, see requireAppAction doc): object-level authz replaces the
// bare global requireRole(['admin']) when the flag is ON.
router.delete(
  '/:id',
  authenticateToken,
  requireAppAction('delete'),
  async (req: any, res) => {
    try {
      const { id } = req.params

      await db('apps').where('id', id).del()

      res.json({ message: 'App deleted successfully' })
    } catch (error) {
      console.error('Error deleting app:', error)
      res.status(500).json({ error: 'Failed to delete app' })
    }
  }
)

// POST /api/apps/:id/heartbeat - App reports it's alive
//
// CRITICAL-2 (gated, see conditionalAuth doc): OFF (default) preserves the
// pre-fix, unauthenticated behavior this router shipped with. ON requires
// authentication and object-level authorization (the caller must be an
// active member of the app's owning organization, or pass a Permit
// App:update), matching backend/src/routes/apps.ts's fix. `status` is always
// validated against an allow-list, and the broadcast metadata projection is
// always sanitized (never raw req.body.metadata) — those are unconditional,
// non-breaking hardening, not part of the authz gate.
router.post(
  '/:id/heartbeat',
  conditionalAuth,
  async (req: any, res, next) => {
    if (!req.appsRegistryAuthzEnabled) return next()
    return requireAppAction('update')(req, res, next)
  },
  async (req: any, res) => {
    try {
      const { id } = req.params
      let { status = 'online' } = req.body

      if (typeof status !== 'string') status = 'online'
      status = status.trim()
      if (!VALID_HEARTBEAT_STATUSES.includes(status as any)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${VALID_HEARTBEAT_STATUSES.join(', ')}`,
        })
      }

      // When the authz gate is ON, requireAppAction already loaded + verified
      // the app exists & is owned; reuse that row rather than re-querying.
      let app: AppRow | undefined = req.app_row
      if (!app) {
        app = (await db('apps')
          .where('id', id)
          .where('is_active', true)
          .first()) as AppRow | undefined
      }
      if (!app || !app.is_active) {
        return res.status(404).json({ error: 'App not found or inactive' })
      }

      // Update app's last heartbeat timestamp
      await db('apps').where('id', id).update({ updated_at: db.fn.now() })

      // Emit WebSocket event to all connected clients. Never broadcast raw
      // attacker-controlled metadata — emit only a fixed, derived projection.
      const io = req.app.get('io')
      if (io) {
        io.emit('app-status-changed', {
          appId: id,
          appName: app.name,
          status,
          isHealthy: status === 'online',
          timestamp: new Date().toISOString(),
        })
      }

      console.log(`💓 Heartbeat received from ${app.name} (${id}): ${status}`)

      res.json({
        success: true,
        message: 'Heartbeat received',
        timestamp: new Date().toISOString(),
      })
    } catch (error: any) {
      console.error('Error processing heartbeat:', error)
      res.status(500).json({ error: 'Failed to process heartbeat' })
    }
  }
)

// POST /api/apps/register - Self-register app
//
// CRITICAL-1 (gated, see conditionalAuth doc): OFF (default) preserves the
// pre-fix, unauthenticated behavior this router shipped with — required for
// clock-app/task-manager-app's current anonymous self-registration calls
// (see FLAGS.LEGACY_OBJECT_LEVEL_AUTHZ doc in ../app-registry/flags.ts). ON
// requires authentication and binds the app to the caller's PERSONAL
// organization (never a client-supplied org id) with a Permit App:create
// check, matching backend/src/routes/apps.ts's fix.
router.post('/register', conditionalAuth, async (req: any, res) => {
  try {
    let {
      name,
      url,
      iconUrl,
      integrationType = 'module-federation',
      remoteUrl,
      scope,
      module,
      description,
      scopeLevel = 'both',
    } = req.body

    let organizationId: string | null = null
    let visibility: 'private' = 'private'

    if (req.appsRegistryAuthzEnabled) {
      // req.user is guaranteed set here: conditionalAuth ran authenticateToken
      // when the flag is ON, and that middleware already 401'd otherwise.
      organizationId = await resolvePersonalOrgId(req.user.id)
      if (!organizationId) {
        return res.status(400).json({
          error: 'Organization context required',
          code: 'ORG_CONTEXT_REQUIRED',
        })
      }
      const permitted = await checkAppPermission(
        req.user.id,
        'create',
        undefined,
        organizationId
      )
      if (!permitted) {
        return res.status(403).json({
          error: 'Insufficient app permissions',
          code: 'APP_PERMISSION_DENIED',
        })
      }
    }

    // Sanitize string fields
    if (typeof name === 'string') name = name.trim()
    if (typeof url === 'string') url = url.trim()
    if (typeof iconUrl === 'string') iconUrl = iconUrl.trim()
    if (typeof integrationType === 'string')
      integrationType = integrationType.trim()
    if (typeof remoteUrl === 'string') remoteUrl = remoteUrl.trim()
    if (typeof scope === 'string') scope = scope.trim()
    if (typeof module === 'string') module = module.trim()
    if (typeof description === 'string') description = description.trim()
    if (typeof scopeLevel === 'string') scopeLevel = scopeLevel.trim()

    if (!name || !url) {
      return res.status(400).json({ error: 'Name and URL are required' })
    }

    if (name.length > 255 || url.length > 255) {
      return res.status(400).json({ error: 'Name or URL is too long' })
    }

    const urlRegex = /^https?:\/\/.+/i
    if (!urlRegex.test(url)) {
      return res
        .status(400)
        .json({ error: 'URL must be a valid HTTP or HTTPS URL' })
    }

    if (iconUrl && (iconUrl.length > 255 || !urlRegex.test(iconUrl))) {
      return res
        .status(400)
        .json({ error: 'Icon URL must be a valid HTTP or HTTPS URL' })
    }

    // Integration type allow-list
    if (!VALID_INTEGRATION_TYPES.includes(integrationType)) {
      return res.status(400).json({
        error: `Invalid integration type. Must be one of: ${VALID_INTEGRATION_TYPES.join(', ')}`,
      })
    }

    // Install scope level validation — same contract as POST / above.
    if (!VALID_SCOPE_LEVELS.includes(scopeLevel)) {
      return res.status(400).json({
        error: `Invalid scopeLevel. Must be one of: ${VALID_SCOPE_LEVELS.join(', ')}`,
      })
    }

    // For module federation, require + validate the federation fields whose
    // values drive what the host shell loads as a remote.
    if (integrationType === 'module-federation') {
      if (!remoteUrl || !scope || !module) {
        return res.status(400).json({
          error: 'Module Federation apps require remoteUrl, scope, and module',
        })
      }
      if (
        remoteUrl.length > 255 ||
        scope.length > 255 ||
        module.length > 255
      ) {
        return res
          .status(400)
          .json({ error: 'remoteUrl, scope, or module is too long' })
      }
      if (!urlRegex.test(remoteUrl)) {
        return res
          .status(400)
          .json({ error: 'remoteUrl must be a valid HTTP or HTTPS URL' })
      }
    }

    const appId = uuidv4()

    // MEDIUM-5: explicit allow-list of columns; org ownership (when the flag
    // is ON) is bound from the verified context, never from raw req.body.
    await db('apps').insert({
      id: appId,
      name,
      url,
      icon_url: iconUrl,
      integration_type: integrationType,
      remote_url: remoteUrl,
      scope,
      module,
      description,
      scope_level: scopeLevel,
      organization_id: organizationId,
      visibility,
    })

    const newApp: App = {
      id: appId,
      name,
      url,
      iconUrl,
      isActive: true,
      integrationType,
      remoteUrl,
      scope,
      module,
      description,
      visibility,
      marketplaceMetadata: {},
      isMarketplaceApproved: false,
      installCount: 0,
      scopeLevel,
    }

    // Emit WebSocket event to notify all connected clients
    const io = req.app.get('io')
    if (io) {
      io.emit('app-registered', {
        app: newApp,
        timestamp: new Date().toISOString(),
      })
    }

    console.log(`🚀 App "${name}" self-registered successfully`)

    res.status(201).json(newApp)
  } catch (error: any) {
    console.error('Error in self-registration:', error)

    // Check if it's a unique constraint violation
    if (
      error.code === '23505' || // PostgreSQL unique violation
      error.message?.includes('duplicate key value') ||
      error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      error.message?.includes('UNIQUE constraint failed')
    ) {
      // Return the existing app instead of an error
      try {
        const existingApp = await db('apps')
          .where('name', req.body.name)
          .first()

        if (existingApp) {
          const app: App = {
            id: existingApp.id,
            name: existingApp.name,
            url: existingApp.url,
            iconUrl: existingApp.icon_url,
            isActive: Boolean(existingApp.is_active),
            integrationType: existingApp.integration_type,
            remoteUrl: existingApp.remote_url,
            scope: existingApp.scope,
            module: existingApp.module,
            description: existingApp.description,
            visibility: existingApp.visibility ?? 'private',
            marketplaceMetadata: {},
            isMarketplaceApproved: false,
            installCount: 0,
            scopeLevel: existingApp.scope_level ?? 'both',
          }
          return res.status(200).json(app)
        }
      } catch (fetchError) {
        console.error('Error fetching existing app:', fetchError)
      }

      return res
        .status(400)
        .json({ error: 'An app with this name already exists' })
    }

    res.status(500).json({ error: 'Failed to register app' })
  }
})

export default router
