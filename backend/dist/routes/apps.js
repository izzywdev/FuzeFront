'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const express_1 = __importDefault(require('express'))
const uuid_1 = require('uuid')
const database_1 = require('../config/database')
const auth_1 = require('../middleware/auth')
const router = express_1.default.Router()
// Health check function for individual apps
async function checkAppHealth(app) {
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
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    console.log(
      `Health check failed for ${app.name} (${app.url}):`,
      errorMessage
    )
    return false
  }
}
// GET /api/apps/health - Check health of all registered apps
router.get('/health', auth_1.authenticateToken, async (req, res) => {
  try {
    const apps = await database_1.db.all(
      'SELECT * FROM apps WHERE is_active = 1 ORDER BY name'
    )
    const healthChecks = await Promise.all(
      apps.map(async app => {
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
// GET /api/apps - Get all registered apps with health status
router.get('/', auth_1.authenticateToken, async (req, res) => {
  try {
    const { healthyOnly } = req.query
    const apps = await database_1.db.all(
      'SELECT * FROM apps WHERE is_active = 1 ORDER BY name'
    )
    // Get health status for all apps
    const appsWithHealth = await Promise.all(
      apps.map(async app => {
        const isHealthy = await checkAppHealth(app)
        return {
          id: app.id,
          name: app.name,
          url: app.url,
          iconUrl: app.icon_url,
          isActive: Boolean(app.is_active),
          isHealthy: isHealthy,
          integrationType: app.integration_type,
          remoteUrl: app.remote_url,
          scope: app.scope,
          module: app.module,
          description: app.description,
        }
      })
    )
    // If healthyOnly is requested, filter by health status
    if (healthyOnly === 'true') {
      const healthyApps = appsWithHealth.filter(app => app.isHealthy)
      res.json(
        healthyApps.map(app => {
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
// POST /api/apps - Register new app (admin only)
router.post(
  '/',
  auth_1.authenticateToken,
  (0, auth_1.requireRole)(['admin']),
  async (req, res) => {
    var _a
    try {
      const {
        name,
        url,
        iconUrl,
        integrationType = 'iframe',
        remoteUrl,
        scope,
        module,
        description,
      } = req.body
      if (!name || !url) {
        return res.status(400).json({ error: 'Name and URL are required' })
      }
      const appId = (0, uuid_1.v4)()
      await database_1.db.run(
        `INSERT INTO apps (id, name, url, icon_url, integration_type, remote_url, scope, module, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          appId,
          name,
          url,
          iconUrl,
          integrationType,
          remoteUrl,
          scope,
          module,
          description,
        ]
      )
      const newApp = {
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
      }
      res.status(201).json(newApp)
    } catch (error) {
      console.error('Error creating app:', error)
      // Check if it's a unique constraint violation
      if (
        error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        ((_a = error.message) === null || _a === void 0
          ? void 0
          : _a.includes('UNIQUE constraint failed'))
      ) {
        return res
          .status(400)
          .json({ error: 'An app with this name already exists' })
      }
      res.status(500).json({ error: 'Failed to create app' })
    }
  }
)
// PUT /api/apps/:id/activate - Activate/deactivate app
router.put(
  '/:id/activate',
  auth_1.authenticateToken,
  (0, auth_1.requireRole)(['admin']),
  async (req, res) => {
    try {
      const { id } = req.params
      const { isActive } = req.body
      await database_1.db.run(
        'UPDATE apps SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [isActive ? 1 : 0, id]
      )
      res.json({ message: 'App status updated successfully' })
    } catch (error) {
      console.error('Error updating app status:', error)
      res.status(500).json({ error: 'Failed to update app status' })
    }
  }
)
// DELETE /api/apps/:id - Deregister app
router.delete(
  '/:id',
  auth_1.authenticateToken,
  (0, auth_1.requireRole)(['admin']),
  async (req, res) => {
    try {
      const { id } = req.params
      await database_1.db.run('DELETE FROM apps WHERE id = ?', [id])
      res.json({ message: 'App deleted successfully' })
    } catch (error) {
      console.error('Error deleting app:', error)
      res.status(500).json({ error: 'Failed to delete app' })
    }
  }
)
// POST /api/apps/:id/heartbeat - App reports it's alive
router.post('/:id/heartbeat', async (req, res) => {
  try {
    const { id } = req.params
    const { status = 'online', metadata = {} } = req.body
    // Verify app exists
    const app = await database_1.db.get(
      'SELECT * FROM apps WHERE id = ? AND is_active = 1',
      [id]
    )
    if (!app) {
      return res.status(404).json({ error: 'App not found or inactive' })
    }
    // Update app's last heartbeat timestamp
    await database_1.db.run(
      'UPDATE apps SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    )
    // Emit WebSocket event to all connected clients
    const io = req.app.get('io')
    if (io) {
      io.emit('app-status-changed', {
        appId: id,
        appName: app.name,
        status: status,
        isHealthy: status === 'online',
        timestamp: new Date().toISOString(),
        metadata,
      })
    }
    console.log(`💓 Heartbeat received from ${app.name} (${id}): ${status}`)
    res.json({
      success: true,
      message: 'Heartbeat received',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error processing heartbeat:', error)
    res.status(500).json({ error: 'Failed to process heartbeat' })
  }
})
exports.default = router
//# sourceMappingURL=apps.js.map
