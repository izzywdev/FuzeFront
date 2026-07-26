import express from 'express'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'

const router = express.Router()

/**
 * Maps a row from the legacy `apps` table to the app-registry App shape so
 * existing backend apps are discoverable by the AppRegistryClient / AppSelector
 * without a separate app-registry microservice.
 */
function rowToRegistryApp(row: any, reqOrigin?: string) {
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
router.get('/apps', authenticateToken, async (req: any, res) => {
  try {
    const { status, limit = '100' } = req.query as Record<string, string>

    let query = db('apps')

    if (status === 'activated') {
      query = query.where('is_active', true)
    } else if (status === 'suspended') {
      query = query.where('is_active', false)
    }

    const rows = await query.limit(parseInt(limit, 10))
    const apps = rows.map(rowToRegistryApp)

    res.json({ apps, nextCursor: null })
  } catch (error: any) {
    console.error('Error fetching app registry:', error)
    res.status(500).json({ error: 'internal_error', message: 'Failed to fetch apps' })
  }
})

export default router