import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { authenticateToken, requireRole } from '../middleware/auth'
import { App } from '../types/shared'

const router = express.Router()

// Database row interface for apps
interface AppRow {
  id: string
  name: string
  url: string
  icon_url: string
  is_active: boolean
  integration_type: 'iframe' | 'module_federation' | 'spa'
  remote_url: string
  scope: string
  module: string
  description: string
  metadata: string
  created_at: Date
  updated_at: Date
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

// GET /api/apps/health - Check health of all registered apps
router.get('/health', authenticateToken, async (req: any, res) => {
  try {
    const apps = await db('apps').where('is_active', true).orderBy('name')

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
 *     summary: Get all registered applications
 *     description: Retrieve a list of all registered applications with their health status
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
 *             example:
 *               - id: "f0e9b957-5e89-456e-a768-f2166932a725"
 *                 name: "Task Manager"
 *                 url: "http://localhost:3002"
 *                 iconUrl: "http://localhost:3002/icon.svg"
 *                 isActive: true
 *                 isHealthy: true
 *                 integrationType: "module-federation"
 *                 remoteUrl: "http://localhost:3002/assets/remoteEntry.js"
 *                 scope: "taskManager"
 *                 module: "./App"
 *                 description: "Personal task management application"
 *       500:
 *         description: Failed to fetch applications
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// GET /api/apps - Get all registered apps with health status
router.get('/', authenticateToken, async (req: any, res) => {
  try {
    const { healthyOnly } = req.query

    const apps = await db('apps').where('is_active', true).orderBy('name')

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
            | 'web-component',
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
 *             examples:
 *               missing-fields:
 *                 summary: Missing required fields
 *                 value:
 *                   error: "Name and URL are required"
 *               duplicate-name:
 *                 summary: Duplicate application name
 *                 value:
 *                   error: "An app with this name already exists"
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
 *             example:
 *               error: "Insufficient permissions"
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

      const appId = uuidv4()

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
      }

      res.status(201).json(newApp)
    } catch (error: any) {
      console.error('Error creating app:', error)

      // Check if it's a unique constraint violation
      if (
        error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        error.message?.includes('UNIQUE constraint failed')
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
  authenticateToken,
  requireRole(['admin']),
  async (req: any, res) => {
    try {
      const { id } = req.params
      const { isActive } = req.body

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
router.delete(
  '/:id',
  authenticateToken,
  requireRole(['admin']),
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
router.post('/:id/heartbeat', async (req: any, res) => {
  try {
    const { id } = req.params
    const { status = 'online', metadata = {} } = req.body

    // Verify app exists
    const app = await db('apps')
      .where('id', id)
      .where('is_active', true)
      .first()

    if (!app) {
      return res.status(404).json({ error: 'App not found or inactive' })
    }

    // Update app's last heartbeat timestamp
    await db('apps').where('id', id).update({ updated_at: db.fn.now() })

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
  } catch (error: any) {
    console.error('Error processing heartbeat:', error)
    res.status(500).json({ error: 'Failed to process heartbeat' })
  }
})

// POST /api/apps/register - Self-register app (no auth required for demo)
router.post('/register', async (req: any, res) => {
  try {
    const {
      name,
      url,
      iconUrl,
      integrationType = 'module-federation',
      remoteUrl,
      scope,
      module,
      description,
    } = req.body

    if (!name || !url) {
      return res.status(400).json({ error: 'Name and URL are required' })
    }

    // For module federation, require additional fields
    if (integrationType === 'module-federation') {
      if (!remoteUrl || !scope || !module) {
        return res.status(400).json({
          error: 'Module Federation apps require remoteUrl, scope, and module',
        })
      }
    }

    const appId = uuidv4()

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
