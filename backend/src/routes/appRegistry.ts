import express, { Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'
import { isPrefixedIdsEnabled } from '../identity/flags'
import { prefixDtoIds } from '../identity/serializer'

const router = express.Router()

// Per-IP rate limit for the registry read. The route is authenticated and
// shell-facing (the portal polls it), so a conservative cap adds defense in
// depth against an unauthenticated flood without affecting normal polling.
// Placed before authenticateToken so abusive traffic is shed before auth work.
const appsReadLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

/**
 * Whether this host-backend should answer app-registry READS from its own local
 * `apps` table instead of delegating to the applications-service proxy
 * (routes/app-registry.ts, mounted at the same path right after this router).
 *
 * Default is FALSE — delegate. The applications-service owns the FROZEN
 * `/api/v1/app-registry` contract and is where every WRITE already lands
 * (self-registration POST/PUT/activate fall through to the proxy because this
 * adapter only defines GET /apps). If the READ is served from the local `apps`
 * table instead, the two stores diverge and self-registered MFEs — e.g.
 * FuzePicker's `picker` remote — are active in the applications-service but
 * absent from what the shell reads, so they never render (FuzeFront #533).
 *
 * The local adapter is a CI / no-applications-service fallback only, enabled
 * explicitly with APP_REGISTRY_LOCAL_ADAPTER=1 (or true/yes). It is keyed on an
 * explicit flag and NOT on APPLICATIONS_SERVICE_URL: prod does not set that env
 * (the proxy defaults it to http://fuzefront-applications:3003), so keying on it
 * would leave the adapter shadowing the proxy in prod — the exact split-brain
 * this fix removes.
 */
function localAdapterEnabled(): boolean {
  const v = (process.env.APP_REGISTRY_LOCAL_ADAPTER || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Maps a row from the legacy `apps` table to the app-registry App shape so
 * existing backend apps are discoverable by the AppRegistryClient / AppSelector
 * without a separate app-registry microservice.
 */
function rowToRegistryApp(row: any) {
  const slug = (row.name as string).toLowerCase().replace(/[^a-z0-9-]/g, '-')

  const integration: Record<string, unknown> = { type: row.integration_type }
  if (row.integration_type === 'module-federation') {
    // `remote_url` may be:
    //   1. A same-origin relative path  (/apps/slug/remoteEntry.js)  — stored this
    //      way for apps deployed in-cluster. The browser resolves it against the
    //      page origin; no WAN hairpin, no cross-origin fetch.
    //   2. A full URL (https://…/remoteEntry.js or http://host:port/…) — legacy
    //      format. Append /remoteEntry.js only when not already a .js URL.
    //
    // Relative paths are returned verbatim so the browser resolves them against
    // the app origin (same nginx that served the shell → in-cluster pod via
    // /apps/<slug>/ ingress). Full URLs are returned unchanged.
    const raw = (row.remote_url as string | null | undefined)?.replace(/\/$/, '') ?? ''
    let remoteEntry: string
    if (raw.startsWith('/')) {
      // Relative path — return as-is; the browser will resolve against origin.
      remoteEntry = raw.endsWith('.js') ? raw : `${raw}/remoteEntry.js`
    } else if (raw) {
      // Absolute URL — use verbatim (or append /remoteEntry.js for base URLs).
      remoteEntry = raw.endsWith('.js') ? raw : `${raw}/remoteEntry.js`
    } else {
      // Fallback: derive a same-origin path from the slug so the app at least
      // has a plausible URL rather than an empty string that crashes the loader.
      remoteEntry = `/apps/${slug}/remoteEntry.js`
    }
    integration.remoteEntry = remoteEntry
    integration.scope = row.scope
    integration.module = row.module
  } else {
    integration.url = row.url
  }

  const mode = row.integration_type === 'module-federation' ? 'portal' : 'standalone'

  return {
    slug,
    status: row.is_active ? 'activated' : 'suspended',
    mode,
    builtin: false,
    organizationId: row.organization_id ?? null,
    isHealthy: null,
    lastSeenAt: null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    manifest: {
      manifestVersion: '1',
      slug,
      name: row.name,
      menuLabel: row.name,
      description: row.description || undefined,
      mode,
      builtin: false,
      integration,
    },
  }
}

// GET /api/v1/app-registry/apps
//
// Delegates to the applications-service proxy unless the local DB adapter is
// explicitly enabled (see localAdapterEnabled). `next()` falls through to
// routes/app-registry.ts, mounted at this same path in src/index.ts — realizing
// the pass-through the mount comment there already promises.
router.get('/apps', appsReadLimiter, authenticateToken, async (req: any, res: Response, next: NextFunction) => {
  if (!localAdapterEnabled()) {
    return next()
  }

  try {
    const { status, limit = '100' } = req.query as Record<string, string>

    let query = db('apps')

    if (status === 'activated') {
      query = query.where('is_active', true)
    } else if (status === 'suspended') {
      query = query.where('is_active', false)
    }

    const rows = await query.limit(parseInt(limit, 10))
    const rawApps = rows.map(rowToRegistryApp)
    const flagCtx = { userId: req.user?.id }
    const prefixed = await isPrefixedIdsEnabled(flagCtx)
    const apps = rawApps.map((app: any) => prefixDtoIds(app, prefixed, { organizationId: 'organization' }))

    res.json({ apps, nextCursor: null })
  } catch (error: any) {
    console.error('Error fetching app registry:', error)
    res.status(500).json({ error: 'internal_error', message: 'Failed to fetch apps' })
  }
})

export default router

// Exported for tests / introspection.
export const __appRegistryAdapterConfig = { localAdapterEnabled }
