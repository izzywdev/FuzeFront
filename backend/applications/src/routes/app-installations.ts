// app-installations.ts — where an app lands, and who it lands for.
//
// `apps` answers who OWNS an app (organization_id) and who may SEE it
// (visibility). This router answers the third question: who is it INSTALLED
// for. See migration 017 and docs/planning/app-scopes-user-menu-notifications.md.
//
// Mounted at /api/apps, BEFORE routes/apps.ts, so the paths below resolve
// before that router's own /:id handlers. Nothing here shadows an existing
// apps.ts route: `/installed`, `/:id/installations` and `/:id/install*` are all
// new paths.
//
// WHY THIS LIVES IN applications-service AND NOT fuzefront-backend
// ---------------------------------------------------------------
// The ingress routes `/api/apps` (Prefix) to fuzefront-applications and only
// the remaining `/api` to fuzefront-backend, and `applicationsService.enabled`
// is true in BOTH values-local.yaml and values-prod.yaml. This router first
// shipped on the backend, where nginx's longest-prefix match meant every
// endpoint below answered 404 in every deployed environment — while the unit
// tests, which mount the router directly, stayed green. Implementation must
// follow path ownership; scripts/check-route-ownership.mjs now fails CI if the
// two ever drift apart again.
//
// The schema it reads (apps.scope_level, app_installations) comes from the
// backend's migration 017, not this service's migration set. Both services
// share one database, and 017 has already been applied to production, so moving
// it here would risk a duplicate apply for no benefit.
//
// Authorization, fail-closed at every step:
//   1. The app must be VISIBLE to the caller (member of its owning org, or the
//      app is public/marketplace). Anything else is a 404, never a 403 — a
//      stranger must not be able to probe which app ids exist.
//   2. The requested scope must be permitted by the app's scope_level (422).
//   3. An organization-scoped install requires an ACTIVE membership of that org.
//   4. mode='everyone' additionally requires owner/admin on that org (403). One
//      member must not be able to push an app into every colleague's launcher.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'

const router = express.Router()

// Every route below performs an authorization decision backed by DB lookups
// (app visibility + org membership), so an unbounded caller can amplify cheap
// requests into repeated database work — and, because a not-entitled app or org
// answers 404, an unbounded caller is also exactly the shape of an id-
// enumeration probe. Same express-rate-limit convention/limits as routes/
// flags.ts and routes/portal.ts.
//
// Both ceilings are env-overridable. The limiter is ALWAYS mounted — it is
// never skipped by environment, because a security control that switches itself
// off outside production is not a control. Test suites raise the ceiling
// instead, and the limiter itself is exercised by its own case in
// tests/app-installations.test.ts.
const READ_LIMIT = parseInt(process.env.APP_INSTALL_READ_RATE_LIMIT || '60', 10)
const WRITE_LIMIT = parseInt(process.env.APP_INSTALL_WRITE_RATE_LIMIT || '30', 10)

// Reads are the generous ceiling: the applications surface fetches them on load.
export const installReadRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: READ_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})

// Writes are tighter. A legitimate caller installs or uninstalls apps rarely —
// 30/min still covers setting up a workspace in one sitting — while bounding
// both id enumeration and install-spam against an org.
export const installWriteRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: WRITE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})

export type AppScopeLevel = 'personal' | 'organization' | 'both'
export type InstallScope = 'personal' | 'organization'
export type InstallMode = 'self' | 'everyone'

const VALID_SCOPES: readonly InstallScope[] = ['personal', 'organization']
const VALID_MODES: readonly InstallMode[] = ['self', 'everyone']

/** Roles that may install an app for EVERYONE in an organization. */
const ORG_ADMIN_ROLES = new Set(['owner', 'admin'])

interface AppRow {
  id: string
  name: string
  organization_id: string | null
  visibility: 'private' | 'organization' | 'public' | 'marketplace'
  scope_level: AppScopeLevel
  install_count: number | null
}

export interface InstallationRow {
  id: string
  app_id: string
  scope: InstallScope
  install_mode: InstallMode
  user_id: string | null
  organization_id: string | null
  installed_by: string
  status: 'active' | 'revoked'
  settings: Record<string, unknown> | null
  created_at: Date
  updated_at: Date
}

function toInstallation(row: InstallationRow) {
  return {
    id: row.id,
    appId: row.app_id,
    scope: row.scope,
    mode: row.install_mode,
    userId: row.user_id,
    organizationId: row.organization_id,
    installedBy: row.installed_by,
    status: row.status,
    settings: row.settings ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Organization ids the caller is an ACTIVE member of. */
async function getMemberOrgIds(userId: string): Promise<string[]> {
  const rows = await db('organization_memberships')
    .where('user_id', userId)
    .where('status', 'active')
    .select('organization_id')
  return rows.map((r: any) => r.organization_id).filter(Boolean)
}

/** The caller's role on one organization, or null when not an active member. */
async function getMembershipRole(
  userId: string,
  organizationId: string
): Promise<string | null> {
  const row = await db('organization_memberships')
    .where('user_id', userId)
    .where('organization_id', organizationId)
    .where('status', 'active')
    .first()
  return row ? row.role : null
}

/**
 * Load an app the caller is entitled to SEE — the same rule the apps collection
 * read applies (org member, or public/marketplace). Returns undefined when the
 * app does not exist OR is not visible; callers must answer 404 for both so the
 * two are indistinguishable from outside.
 */
async function loadVisibleApp(
  appId: string,
  memberOrgIds: string[]
): Promise<AppRow | undefined> {
  const app = (await db('apps').where('id', appId).first()) as
    | AppRow
    | undefined
  if (!app) return undefined

  if (app.visibility === 'public' || app.visibility === 'marketplace') {
    return app
  }
  if (app.organization_id && memberOrgIds.includes(app.organization_id)) {
    return app
  }
  return undefined
}

/**
 * Is `scope` permitted by the app's declared scope_level?
 * A missing scope_level (a row written before migration 017 ran on this
 * connection) is read as 'both' — the column default.
 */
export function scopeIsAllowed(
  scopeLevel: AppScopeLevel | null | undefined,
  scope: InstallScope
): boolean {
  const level = scopeLevel ?? 'both'
  if (level === 'both') return true
  return level === scope
}

/** Keep apps.install_count in step with the number of ACTIVE installations. */
async function syncInstallCount(appId: string): Promise<void> {
  const [{ count }] = await db('app_installations')
    .where('app_id', appId)
    .where('status', 'active')
    .count({ count: '*' })
  await db('apps')
    .where('id', appId)
    .update({ install_count: Number(count), updated_at: db.fn.now() })
}

// ---------------------------------------------------------------------------
// GET /api/apps/installed — the caller's EFFECTIVE apps for an organization.
//
// The union of: their personal installs, their org-`self` installs in that org,
// and every `everyone` install on that org. Without `organizationId` only the
// personal installs are returned.
// ---------------------------------------------------------------------------
router.get('/installed', installReadRateLimiter, authenticateToken, async (req: any, res) => {
  try {
    const userId = req.user.id
    const organizationId =
      typeof req.query.organizationId === 'string'
        ? req.query.organizationId
        : undefined

    // An org filter the caller is not a member of yields nothing rather than
    // leaking whether that org has installs.
    let orgIsVisible = false
    if (organizationId) {
      orgIsVisible = (await getMembershipRole(userId, organizationId)) !== null
    }

    const rows = (await db('app_installations')
      .join('apps', 'apps.id', 'app_installations.app_id')
      .where('app_installations.status', 'active')
      .where(function (this: any) {
        this.where(function (this: any) {
          this.where('app_installations.scope', 'personal').where(
            'app_installations.user_id',
            userId
          )
        })
        if (organizationId && orgIsVisible) {
          this.orWhere(function (this: any) {
            this.where('app_installations.scope', 'organization')
              .where('app_installations.organization_id', organizationId)
              .where(function (this: any) {
                this.where('app_installations.install_mode', 'everyone').orWhere(
                  function (this: any) {
                    this.where(
                      'app_installations.install_mode',
                      'self'
                    ).where('app_installations.user_id', userId)
                  }
                )
              })
          })
        }
      })
      .select(
        'app_installations.*',
        'apps.name as app_name',
        'apps.url as app_url',
        'apps.icon_url as app_icon_url',
        'apps.is_active as app_is_active',
        'apps.scope_level as app_scope_level'
      )
      .orderBy('apps.name')) as any[]

    res.json(
      rows.map(row => ({
        ...toInstallation(row as InstallationRow),
        app: {
          id: row.app_id,
          name: row.app_name,
          url: row.app_url,
          iconUrl: row.app_icon_url,
          isActive: row.app_is_active,
          scopeLevel: row.app_scope_level ?? 'both',
        },
      }))
    )
  } catch (error) {
    console.error('Error listing installed apps:', error)
    res.status(500).json({ error: 'Failed to list installed apps' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/apps/:id/installations — installations of ONE app visible to the
// caller: their own (personal + org-self) plus every `everyone` install on an
// org they belong to.
// ---------------------------------------------------------------------------
router.get('/:id/installations', installReadRateLimiter, authenticateToken, async (req: any, res) => {
  try {
    const userId = req.user.id
    const memberOrgIds = await getMemberOrgIds(userId)
    const app = await loadVisibleApp(req.params.id, memberOrgIds)
    if (!app) {
      return res
        .status(404)
        .json({ error: 'App not found', code: 'APP_NOT_FOUND' })
    }

    const rows = (await db('app_installations')
      .where('app_id', app.id)
      .where('status', 'active')
      .where(function (this: any) {
        this.where('user_id', userId)
        if (memberOrgIds.length > 0) {
          this.orWhere(function (this: any) {
            this.where('install_mode', 'everyone').whereIn(
              'organization_id',
              memberOrgIds
            )
          })
        }
      })
      .orderBy('created_at')) as InstallationRow[]

    res.json({
      appId: app.id,
      scopeLevel: app.scope_level ?? 'both',
      installations: rows.map(toInstallation),
    })
  } catch (error) {
    console.error('Error listing app installations:', error)
    res.status(500).json({ error: 'Failed to list app installations' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/apps/:id/install — install for the caller, or for an organization.
//
// Body: { scope?, organizationId?, mode?, settings? }
//   scope         'personal' | 'organization'. Required when the app's
//                 scope_level is 'both'; otherwise inferred from scope_level.
//   organizationId required for scope='organization'.
//   mode          'self' (default) | 'everyone'. 'everyone' needs owner/admin.
//
// Idempotent per target: an existing active installation is returned with 200
// rather than duplicated (the partial unique indexes in migration 017 are the
// backstop if two requests race).
// ---------------------------------------------------------------------------
router.post('/:id/install', installWriteRateLimiter, authenticateToken, async (req: any, res) => {
  try {
    const userId = req.user.id
    const memberOrgIds = await getMemberOrgIds(userId)
    const app = await loadVisibleApp(req.params.id, memberOrgIds)
    if (!app) {
      return res
        .status(404)
        .json({ error: 'App not found', code: 'APP_NOT_FOUND' })
    }

    const scopeLevel: AppScopeLevel = app.scope_level ?? 'both'
    const body = req.body ?? {}

    // --- resolve scope ----------------------------------------------------
    let scope: InstallScope
    if (body.scope === undefined || body.scope === null) {
      if (scopeLevel === 'both') {
        return res.status(400).json({
          error:
            "scope is required for an app whose scopeLevel is 'both'. Pass 'personal' or 'organization'.",
          code: 'SCOPE_REQUIRED',
        })
      }
      scope = scopeLevel
    } else {
      if (!VALID_SCOPES.includes(body.scope)) {
        return res.status(400).json({
          error: `Invalid scope. Must be one of: ${VALID_SCOPES.join(', ')}`,
          code: 'INVALID_SCOPE',
        })
      }
      scope = body.scope
    }

    if (!scopeIsAllowed(scopeLevel, scope)) {
      return res.status(422).json({
        error: `This app cannot be installed at '${scope}' scope. Its scopeLevel is '${scopeLevel}'.`,
        code: 'SCOPE_NOT_PERMITTED',
      })
    }

    // --- resolve mode -----------------------------------------------------
    // A personal install is always just you; an explicit mode='everyone' there
    // is a contradiction and is rejected rather than silently downgraded.
    let mode: InstallMode = 'self'
    if (body.mode !== undefined && body.mode !== null) {
      if (!VALID_MODES.includes(body.mode)) {
        return res.status(400).json({
          error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}`,
          code: 'INVALID_MODE',
        })
      }
      mode = body.mode
    }
    if (scope === 'personal' && mode === 'everyone') {
      return res.status(422).json({
        error: "mode 'everyone' is only valid for an organization install.",
        code: 'MODE_NOT_PERMITTED',
      })
    }

    // --- resolve target ---------------------------------------------------
    let organizationId: string | null = null
    if (scope === 'organization') {
      if (typeof body.organizationId !== 'string' || !body.organizationId) {
        return res.status(400).json({
          error: 'organizationId is required for an organization install',
          code: 'ORGANIZATION_REQUIRED',
        })
      }
      organizationId = body.organizationId

      const role = await getMembershipRole(userId, organizationId)
      if (role === null) {
        // Not a member: 404 on the ORG, same non-disclosure rule as the app.
        return res.status(404).json({
          error: 'Organization not found',
          code: 'ORGANIZATION_NOT_FOUND',
        })
      }
      if (mode === 'everyone' && !ORG_ADMIN_ROLES.has(role)) {
        return res.status(403).json({
          error:
            'Installing for everyone requires an organization owner or admin',
          code: 'REQUIRES_ORG_ADMIN',
        })
      }
    }

    // The anchor columns each shape carries. Mirrors the CHECK constraint in
    // migration 017 — keep the two in step.
    const anchorUserId =
      scope === 'personal' || mode === 'self' ? userId : null

    // --- idempotency ------------------------------------------------------
    const existing = (await db('app_installations')
      .where('app_id', app.id)
      .where('status', 'active')
      .where('scope', scope)
      .where('install_mode', mode)
      .where(builder => {
        if (organizationId) builder.where('organization_id', organizationId)
        else builder.whereNull('organization_id')
      })
      .where(builder => {
        if (anchorUserId) builder.where('user_id', anchorUserId)
        else builder.whereNull('user_id')
      })
      .first()) as InstallationRow | undefined

    if (existing) {
      return res.status(200).json({
        installation: toInstallation(existing),
        alreadyInstalled: true,
      })
    }

    const settings =
      body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)
        ? body.settings
        : {}

    const [inserted] = (await db('app_installations')
      .insert({
        app_id: app.id,
        scope,
        install_mode: mode,
        user_id: anchorUserId,
        organization_id: organizationId,
        installed_by: userId,
        status: 'active',
        settings: JSON.stringify(settings),
      })
      .returning('*')) as InstallationRow[]

    await syncInstallCount(app.id)

    res.status(201).json({
      installation: toInstallation(inserted),
      alreadyInstalled: false,
    })
  } catch (error: any) {
    // A unique-violation here means two concurrent installs raced. The target
    // is installed either way, so report the winner rather than a 500.
    if (error?.code === '23505') {
      return res
        .status(409)
        .json({ error: 'Already installed', code: 'ALREADY_INSTALLED' })
    }
    console.error('Error installing app:', error)
    res.status(500).json({ error: 'Failed to install app' })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/apps/:id/install/:installationId — soft-revoke an installation.
//
// A personal or org-`self` install may be removed by the user it belongs to.
// An `everyone` install may be removed only by an owner/admin of that org —
// removing it takes the app out of every member's launcher.
// ---------------------------------------------------------------------------
router.delete(
  '/:id/install/:installationId',
  installWriteRateLimiter,
  authenticateToken,
  async (req: any, res) => {
    try {
      const userId = req.user.id
      const memberOrgIds = await getMemberOrgIds(userId)
      const app = await loadVisibleApp(req.params.id, memberOrgIds)
      if (!app) {
        return res
          .status(404)
          .json({ error: 'App not found', code: 'APP_NOT_FOUND' })
      }

      const installation = (await db('app_installations')
        .where('id', req.params.installationId)
        .where('app_id', app.id)
        .where('status', 'active')
        .first()) as InstallationRow | undefined

      if (!installation) {
        return res.status(404).json({
          error: 'Installation not found',
          code: 'INSTALLATION_NOT_FOUND',
        })
      }

      if (installation.install_mode === 'everyone') {
        const role = installation.organization_id
          ? await getMembershipRole(userId, installation.organization_id)
          : null
        if (role === null) {
          return res.status(404).json({
            error: 'Installation not found',
            code: 'INSTALLATION_NOT_FOUND',
          })
        }
        if (!ORG_ADMIN_ROLES.has(role)) {
          return res.status(403).json({
            error:
              'Uninstalling for everyone requires an organization owner or admin',
            code: 'REQUIRES_ORG_ADMIN',
          })
        }
      } else if (installation.user_id !== userId) {
        // Someone else's personal / org-self install. Non-disclosing 404.
        return res.status(404).json({
          error: 'Installation not found',
          code: 'INSTALLATION_NOT_FOUND',
        })
      }

      await db('app_installations').where('id', installation.id).update({
        status: 'revoked',
        revoked_at: db.fn.now(),
        revoked_by: userId,
        updated_at: db.fn.now(),
      })

      await syncInstallCount(app.id)

      res.json({ message: 'App uninstalled successfully' })
    } catch (error) {
      console.error('Error uninstalling app:', error)
      res.status(500).json({ error: 'Failed to uninstall app' })
    }
  }
)

export default router
