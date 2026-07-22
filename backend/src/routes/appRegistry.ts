import express from 'express'
import { db } from '../config/database'
import { authenticateToken } from '../middleware/auth'

const router = express.Router()

/**
 * Maps a row from the legacy `apps` table to the app-registry App shape so
 * existing backend apps are discoverable by the AppRegistryClient / AppSelector
 * without a separate app-registry microservice.
 */
function rowToRegistryApp(row: any) {
  const slug = (row.name as string).toLowerCase().replace(/[^a-z0-9-]/g, '-')

  const integration: Record<string, unknown> = { type: row.integration_type }
  if (row.integration_type === 'module-federation') {
    // `remote_url` may hold a full remoteEntry URL (stored by the applications
    // service as `manifest.integration.remoteEntry`) OR a legacy base directory.
    // Append /remoteEntry.js only when it is not already a .js file URL.
    const raw = (row.remote_url as string).replace(/\/$/, '')
    integration.remoteEntry = raw.endsWith('.js') ? raw : `${raw}/remoteEntry.js`
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