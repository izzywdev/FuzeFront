import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken, requireRole } from '../middleware/auth'
import { requireAppPermission } from '../middleware/permissions'
import { App } from '../types/shared'

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
  created_at: Date
  updated_at: Date
}

const VALID_INTEGRATION_TYPES = [
  'iframe',
  'module-federation',
  'web-component',
  'spa',
] as const

const VALID_HEARTBEAT_STATUSES = ['online', 'offline', 'degraded'] as const

// ---------------------------------------------------------------------------
// Authorization helpers (object-level, org-scoped)
//
// `apps.organization_id` is the ownership anchor (migration 006). We authorize
// the SPECIFIC app the same way organizations.ts authorizes a specific org:
// join the app's owning organization to the caller's active memberships. This
// is the BOLA/IDOR fix — global `requireRole(['admin'])` is replaced by an
// object-level check that the caller is actually entitled on THIS app's org.
// ---------------------------------------------------------------------------

interface AppAuthzResult {
  app: AppRow | undefined
  membershipRole: string | null
}

/**
 * Load an app plus the caller's membership role on the app's owning org.
 * Returns the app (or undefined if it doesn't exist) and the caller's role on
 * the owning organization (or null if the caller is not an active member).
 */
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

/**
 * Object-level authorization middleware for app mutations.
 *
 * Allows the action when the caller is an owner/admin member of the app's
 * owning organization (object-level), OR a Permit `App:<action>` check passes
 * for the app within its org (policy layer). Falls back to a platform `admin`
 * role only for legacy un-owned apps. Fails closed (403/404) otherwise.
 *
 * This replaces the bare `requireRole(['admin'])` that let ANY platform admin
 * mutate ANY app regardless of tenant ownership (HIGH-3).
 */
function requireAppAction(action: 'update' | 'delete') {
  return async (req: any, res: express.Response, next: express.NextFunction) => {
    try {
      if (!req.user?.id) {
        return res
          .status(401)
          .json({ error: 'Authentication required', code: 'AUTH_REQUIRED' })
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

      // Policy layer: defer to Permit for this specific app within its org.
      if (app.organization_id) {
        const { checkAppPermission } = await import(
          '../utils/permit/permission-check'
        )
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
      } else {
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
 * Build the SET of organization IDs the caller may see apps from (their active
 * memberships). Used to scope collection reads (HIGH-4).
 */
async function getMemberOrgIds(userId: string): Promise<string[]> {
  const rows = await db('organization_memberships')
    .where('user_id', userId)
    .where('status', 'active')
    .select('organization_id')
  return rows.map((r: any) => r.organization_id).filter(Boolean)
}

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
    // Legacy / platform apps registered by admins without an org anchor remain
    // visible to all authenticated users (consistent with requireAppAction's
    // "un-owned app" handling).
    this.orWhereNull('apps.organization_id')
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

// GET /api/apps/health - Check health of apps the caller is entitled to see
router.get('/health', authenticateToken, async (req: any, res) => {
  try {
    // HIGH-4: scope to the caller's orgs + public/marketplace visibility
    // instead of returning every active app on the platform.
    const memberOrgIds = await getMemberOrgIds(req.user.id)
    const apps = await scopeAppsQuery(
      db('apps').where('is_active', true),
      memberOrgIds
    ).orderBy('name')

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
 *     summary: Get registered applications the caller is entitled to see
 *     description: >-
 *       Retrieve applications scoped to the caller's organization memberships
 *       and to public/marketplace visibility, with their health status.
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
// GET /api/apps - Get apps the caller is entitled to see, with health status
router.get('/', authenticateToken, async (req: any, res) => {
  try {
    const { healthyOnly } = req.query

    // HIGH-4: object-level read scoping (org membership + visibility).
    const memberOrgIds = await getMemberOrgIds(req.user.id)
    const apps = await scopeAppsQuery(
      db('apps').where('is_active', true),
      memberOrgIds
    ).orderBy('name')

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
 *     responses:
 *       201:
 *         description: Application registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/App'
 *       400:
 *         description: Bad request - missing required fields or duplicate name
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin role required
 *       500:
 *         description: Failed to create application
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
// HIGH-3 + MEDIUM-5: object-level authz (owner/admin of the app's org, or a
// Permit App:update) replaces the bare global requireRole(['admin']); and only
// the boolean `is_active` (coerced) is written from the body, never raw fields.
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
// HIGH-3: object-level authz replaces the bare global requireRole(['admin']).
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
// CRITICAL-2: this was UNAUTHENTICATED — any anonymous caller could spoof
// `app-status-changed` socket events for any app id and broadcast arbitrary
// metadata. It is now authenticated and authorized object-level: the caller
// must be an active member of the app's owning organization (or pass a Permit
// App:update). `status` is validated against an allow-list, and only a small,
// sanitized metadata projection is broadcast (never raw req.body.metadata).
router.post(
  '/:id/heartbeat',
  authenticateToken,
  requireAppAction('update'),
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

      // requireAppAction already loaded + verified the app exists & is owned.
      const app = req.app_row as AppRow
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

      console.log(`Heartbeat received from ${app.name} (${id}): ${status}`)

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
// CRITICAL-1: this was UNAUTHENTICATED ("no auth required for demo"), letting
// any anonymous caller inject module-federation apps with attacker-controlled
// remoteUrl/scope/module — the host shell then loads those as federated remotes
// (arbitrary remote load / stored-XSS into every shell). It is now
// authenticated AND org-scoped via `requireAppPermission('create')`, the app is
// owned by the caller's organization, and it shares the same validation +
// allow-list insert as POST /api/apps.
router.post(
  '/register',
  authenticateToken,
  requireAppPermission('create'),
  async (req: any, res) => {
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
      } = req.body

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

      // The owning org comes from the verified request context set by
      // requireAppPermission, NOT from the request body (no tenant spoofing).
      const organizationId =
        req.organization?.id ||
        req.params.organizationId ||
        req.user.organizationId

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

      // MEDIUM-5: explicit allow-list of columns; org ownership is bound from
      // the verified context, never from raw req.body.
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
        organization_id: organizationId || null,
        visibility: 'private',
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
      }

      // Emit WebSocket event to notify all connected clients
      const io = req.app.get('io')
      if (io) {
        io.emit('app-registered', {
          app: newApp,
          timestamp: new Date().toISOString(),
        })
      }

      console.log(`App "${name}" self-registered successfully`)

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
              visibility: 'private',
              marketplaceMetadata: {},
              isMarketplaceApproved: false,
              installCount: 0,
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
  }
)

export default router
