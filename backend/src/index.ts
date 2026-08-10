// FuzeFront Backend - Updated 2025-06-19 13:15 - Auth & Health Fix
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { createServer } from 'http'
import dotenv from 'dotenv'

// Import routes
import authRoutes from './routes/auth'
import notificationProxyRoutes from './routes/notifications'
import organizationsRoutes from './routes/organizations'
import invitationsRoutes from './routes/invitations'
import usersRoutes from './routes/users'
import internalRoutes from './routes/internal'
import billingRoutes, { billingWebhookRouter } from './routes/billing'
import appRegistryRoutes from './routes/appRegistry'
import appRegistryProxyRoutes from './routes/app-registry'
import flagsRoutes from './routes/flags'
import portalRoutes from './routes/portal'
import adminPortalRoutes from './routes/adminPortals'
import { resolvePortalContext } from './middleware/portalContext'
import { ensureRootPortal } from './repositories/portalRepository'
import {
  syncPermitSchemaFromRegistry,
  loadLegacyProductPolicies,
  getPermitSyncStatus,
} from './permit/sync-permit-schema'
import permitClient from './config/permit'
import { ensureRootOrgAdmins } from './services/rootOrgAdmin'
import { initFeatureFlags } from './utils/feature-flags'
import { initializeSocketIO } from './sockets/socketHandler'
import {
  initializeDatabase,
  closeDatabase,
  checkDatabaseHealth,
} from './config/database'
import { oidcService } from './services/oidc'
import { setupMetrics } from './metrics'
import { provisionM2MClients } from './authentik/provision-m2m-clients'
import { startBillingProjection, stopBillingProjection } from './services/billingProjection'

// Load environment variables
dotenv.config()

// Prometheus metrics (Phase E). Scraped at /metrics; gracefully degrades to a
// 503 if prom-client is not installed.
const metrics = setupMetrics()

// Extend Express Request interface to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string
    }
  }
}

const app = express()
// Behind the k8s ingress every request otherwise carries the ingress IP —
// trust the first proxy hop so req.ip (rate limiting, auth logs) reflects
// the real client from X-Forwarded-For.
app.set('trust proxy', 1)
const httpServer = createServer(app)
const PORT = process.env.PORT || 3001

// Initialize Socket.IO
const io = initializeSocketIO(httpServer)

// Make io available to routes
app.set('io', io)

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameSrc: ["'self'", '*'], // Allow iframes for microfrontends
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Allow scripts for dynamic loading
      },
    },
  })
)

app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'http://localhost:8085', // Production frontend external URL
      'http://localhost:3004', // Allow calls from external backend port
      'http://fuzefront-frontend-prod:8080', // Internal container URL
    ],
    credentials: true,
  })
)

// Stripe webhook passthrough MUST be mounted before the global JSON body parser
// so the raw signed bytes survive for downstream signature verification. It uses
// its own express.raw() parser. (See routes/billing.ts.)
app.use('/api/v1/billing/webhooks/stripe', billingWebhookRouter)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Enhanced request logging middleware
app.use((req, res, next) => {
  const requestId = require('uuid').v4().substring(0, 8)
  const startTime = Date.now()

  // Add request ID to request object for tracking
  req.requestId = requestId

  console.log(`📥 [${requestId}] ${req.method} ${req.path}`, {
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    origin: req.get('Origin'),
    referer: req.get('Referer'),
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    authorization: req.get('Authorization') ? 'Bearer ***' : 'none',
    query: Object.keys(req.query).length > 0 ? req.query : 'none',
    bodySize: req.body ? JSON.stringify(req.body).length : 0,
  })

  // Log response when it finishes
  const originalSend = res.send
  res.send = function (data) {
    const responseTime = Date.now() - startTime
    console.log(
      `📤 [${requestId}] ${req.method} ${req.path} - ${res.statusCode}`,
      {
        responseTime: `${responseTime}ms`,
        statusCode: res.statusCode,
        contentType: res.get('Content-Type'),
        responseSize: data ? data.length : 0,
      }
    )
    return originalSend.call(this, data)
  }

  next()
})

// Prometheus request metrics (records method/route/status + duration).
app.use(metrics.middleware)
// Expose /metrics for the Prometheus scrape.
metrics.registerEndpoint(app)

// FF-EPIC-10-S1 — resolves req.portal from Host / `/p/<slug>` / root for every
// request, BEFORE authenticateToken so JWT/session portal binding (S3) and the
// public /api/v1/portal/context boot endpoint (S2) can read it. Gated by
// `fuzefront.platform.multi-tenant-portals` (default OFF) — a pure no-op while
// the flag is off, so this line changes no existing route's behavior.
app.use(resolvePortalContext)

// Setup Swagger documentation
try {
  // Only import and setup Swagger if packages are available
  const { specs, swaggerUi } = require('./config/swagger.js')

  /**
   * @swagger
   * tags:
   *   - name: Authentication
   *     description: User authentication and session management
   *   - name: Applications
   *     description: Microfrontend application management
   *   - name: Health
   *     description: System health and status endpoints
   */

  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(specs, {
      explorer: true,
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'FrontFuse API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
      },
    })
  )

  console.log(
    '📚 Swagger documentation available at http://localhost:' +
      PORT +
      '/api-docs'
  )
} catch (error) {
  console.warn(
    '⚠️  Swagger documentation not available (packages not installed)'
  )

  // Provide a simple fallback API documentation
  app.get('/api-docs', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>FrontFuse API Documentation</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 2rem; }
          .endpoint { background: #f5f5f5; padding: 1rem; margin: 1rem 0; border-radius: 8px; }
          .method { font-weight: bold; color: #007bff; }
          .path { font-family: monospace; background: #e9ecef; padding: 0.2rem 0.5rem; border-radius: 4px; }
          pre { background: #f8f9fa; padding: 1rem; border-radius: 8px; overflow-x: auto; }
        </style>
      </head>
      <body>
        <h1>🚀 FrontFuse API Documentation</h1>
        <p>Welcome to the FrontFuse Platform API. This is a simplified documentation view.</p>
        
        <h2>🔐 Authentication Endpoints</h2>
        <div class="endpoint">
          <div><span class="method">POST</span> <span class="path">/api/auth/login</span></div>
          <p>Authenticate user with email and password</p>
          <pre>
{
  "email": "admin@frontfuse.dev",
  "password": "admin123"
}
          </pre>
        </div>
        
        <div class="endpoint">
          <div><span class="method">GET</span> <span class="path">/api/auth/user</span></div>
          <p>Get current authenticated user information</p>
          <p><strong>Requires:</strong> Authorization: Bearer &lt;token&gt;</p>
        </div>
        
        <div class="endpoint">
          <div><span class="method">POST</span> <span class="path">/api/auth/logout</span></div>
          <p>Logout current user and invalidate session</p>
          <p><strong>Requires:</strong> Authorization: Bearer &lt;token&gt;</p>
        </div>
        
        <h2>📱 Application Management</h2>
        <p>
          The app registry (<code>/api/apps/*</code>) is served by
          fuzefront-applications, not this service — the ingress routes that
          prefix there by longest-prefix match. See
          backend/applications/src/routes/apps.ts.
        </p>

        <h2>💓 Health & Monitoring</h2>
        <div class="endpoint">
          <div><span class="method">GET</span> <span class="path">/health</span></div>
          <p>Platform health check endpoint</p>
          <p><strong>No authentication required</strong></p>
        </div>

        <h2>🔑 Authentication</h2>
        <p>Most endpoints require a JWT token in the Authorization header:</p>
        <pre>Authorization: Bearer &lt;your-jwt-token&gt;</pre>
        
        <h2>📞 Support</h2>
        <p>For full interactive documentation, install swagger packages:</p>
        <pre>npm install swagger-ui-express swagger-jsdoc</pre>
        
        <p>For support: <a href="mailto:support@frontfuse.dev">support@frontfuse.dev</a></p>
      </body>
      </html>
    `)
  })

  console.log(
    '📚 Basic API documentation available at http://localhost:' +
      PORT +
      '/api-docs'
  )
}

// Routes
app.use('/api/auth', authRoutes)
// NOTE: the app registry AND its installation routes are deliberately NOT
// mounted here. The ingress routes `/api/apps` (Prefix) to
// fuzefront-applications and only the remaining `/api` to fuzefront-backend,
// and applicationsService.enabled is true in BOTH values-local.yaml and
// values-prod.yaml. A duplicate copy of the registry router (routes/apps.ts)
// lived on this service until it was deleted as dead code: it never received
// a single real request in any deployed environment (mounting it here made
// its routes 404 through the ingress) while its own unit tests — which mount
// the router directly and never traverse the ingress — stayed green. The
// live implementation, including the appsec #100 object-level-authz fix
// ported into it, is backend/applications/src/routes/apps.ts; the app
// INSTALLATION routes are backend/applications/src/routes/
// app-installations.ts. See scripts/check-route-ownership.mjs, which fails CI
// if this pairing is ever broken again.
app.use('/api/organizations', organizationsRoutes)
// FF-EPIC-11-S3 — public token-based invitation resolve/accept (routes/invitations.ts).
app.use('/api/invitations', invitationsRoutes)
app.use('/api/users', usersRoutes)
// Browser-facing flag reads, evaluated server-side against the AUTHENTICATED
// session so the `developers` segment cannot be self-assigned by a client.
app.use('/api/flags', flagsRoutes)
// Portal context boot + the caller's own portal (FF-EPIC-10-S2). Both routes
// are individually flag-gated (404 when off) — see routes/portal.ts.
app.use('/api/v1/portal', portalRoutes)
app.use('/api/v1/admin/portals', adminPortalRoutes)
// Billing proxy: browser -> backend -> fuzefront-billing-service:3006 (adds the
// internal token). Webhook subroute is mounted separately above (raw body).
app.use('/api/v1/billing', billingRoutes)
// App-registry: CI/local uses a direct DB adapter (routes/appRegistry); prod uses a
// proxy to the applications-service (routes/app-registry). Mount adapter first so CI
// env (no applications-service) is served from the local DB, then the proxy handles
// any requests the adapter passes through via next().
// Same-origin proxy to the notification-service. The shell's bell talks to
// /api/v1/notifications/*; this forwards it in-cluster. The service's
// /internal/* publish surface is blocked here — see routes/notifications.ts.
app.use('/api/v1/notifications', notificationProxyRoutes)

app.use('/api/v1/app-registry', appRegistryRoutes)
// App-registry proxy: browser -> backend -> fuzefront-applications:3003. The
// ingress `/api` catch-all + frontend nginx both route the manifest-shaped
// `/api/v1/app-registry/*` here, so without this the registry client 404s and no
// federated app (e.g. the built-in Clock) can mount. Forwards the platform JWT
// verbatim; the applications-service does its own authn/authz.
app.use('/api/v1/app-registry', appRegistryProxyRoutes)
// Internal, secret-guarded provisioning endpoint (NOT exposed via public ingress).
app.use('/internal', internalRoutes)

// Serve static documentation files
app.use('/docs', express.static('docs'))

// User info route
app.get('/api/user', (req, res) => {
  // This will be handled by the auth middleware in production
  res.json({ message: 'User endpoint - use /auth/user instead' })
})

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Check if the FrontFuse platform is running and get system information
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Platform is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 *             example:
 *               status: "ok"
 *               timestamp: "2024-01-01T12:00:00.000Z"
 *               uptime: 3600
 *               version: "1.0.0"
 *               environment: "development"
 *               memory:
 *                 used: 45
 *                 total: 128
 */
// Health check
const startTime = Date.now()

// One builder for both routes below. They were byte-identical copies; a third
// copy of the same object is how one of them silently stops reporting a field.
//
// The `permit` block is the ONLY signal that the AuthZ schema sync did or did not
// include self-registered product policies. Every failure on that path is
// deliberately soft (the platform must boot; one bad policy must not block the
// rest; authorization already fails closed) — and the symptom of a silent drop is
// "this product's users have no permissions", which reads as a product bug. A
// product team can now answer it themselves:
//     curl -s https://app.fuzefront.com/health | jq .permit
// The HTTP status stays 200 regardless, so the k8s probes on this path are
// unaffected — a stale Permit schema must not restart the pod.
export async function buildHealthPayload() {
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  const dbHealthy = await checkDatabaseHealth()
  const permit = getPermitSyncStatus()
  const permitHealthy = permit.outcome === 'ok' && permit.rejectedProducts.length === 0

  return {
    status: dbHealthy && permitHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: uptime,
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbHealthy ? 'connected' : 'disconnected',
      type: 'PostgreSQL',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'fuzefront_platform',
    },
    permit,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  }
}

// Main health check endpoint (without /api prefix)
app.get('/health', async (req, res) => {
  res.json(await buildHealthPayload())
})

// Add /api/health endpoint to match frontend expectations
app.get('/api/health', async (req, res) => {
  res.json(await buildHealthPayload())
})

// Error handling middleware
app.use((err: any, req: any, res: any, next: any) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Something went wrong!' })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Graceful shutdown function
function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`)

  httpServer.close(err => {
    if (err) {
      console.error('❌ Error during server shutdown:', err)
      process.exit(1)
    }

    console.log('✅ HTTP server closed')

    // Close Socket.IO connections
    io.close(async () => {
      console.log('✅ Socket.IO server closed')

      // Close database connections
      try {
        await closeDatabase()
        console.log('✅ Database connections closed')
      } catch (error) {
        console.error('❌ Error closing database:', error)
      }

      // Stop the billing plan-state projection consumer (no-op if never started)
      try {
        await stopBillingProjection()
      } catch (error) {
        console.error('❌ Error stopping billing projection consumer:', error)
      }

      console.log('🎯 Graceful shutdown complete')
      process.exit(0)
    })
  })

  // Force exit after 30 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error('⏰ Graceful shutdown timeout - forcing exit')
    process.exit(1)
  }, 30000)
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught exceptions
process.on('uncaughtException', err => {
  console.error('💥 Uncaught Exception:', err)
  gracefulShutdown('uncaughtException')
})

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason)
  gracefulShutdown('unhandledRejection')
})

// Function to find available port
async function findAvailablePort(
  startPort: number,
  maxAttempts: number = 10
): Promise<number> {
  return new Promise((resolve, reject) => {
    const currentPort = startPort
    let attempts = 0

    function tryPort(port: number) {
      const testServer = require('net').createServer()

      testServer.listen(port, (err: any) => {
        if (err) {
          testServer.close()
          attempts++

          if (attempts >= maxAttempts) {
            reject(
              new Error(
                `No available port found after ${maxAttempts} attempts starting from ${startPort}`
              )
            )
            return
          }

          console.log(`⚠️  Port ${port} is busy, trying ${port + 1}...`)
          tryPort(port + 1)
        } else {
          testServer.close(() => {
            resolve(port)
          })
        }
      })

      testServer.on('error', (err: any) => {
        testServer.close()
        attempts++

        if (attempts >= maxAttempts) {
          reject(
            new Error(
              `No available port found after ${maxAttempts} attempts starting from ${startPort}`
            )
          )
          return
        }

        console.log(`⚠️  Port ${port} is busy, trying ${port + 1}...`)
        tryPort(port + 1)
      })
    }

    tryPort(currentPort)
  })
}

// Start server with port conflict handling
async function startServer() {
  try {
    // Initialize database first
    console.log('🔄 Starting FuzeFront Backend Server...')
    await initializeDatabase()

    // Initialize OIDC service
    try {
      console.log('🔧 Initializing OIDC service...')
      if (oidcService.isConfigured()) {
        await oidcService.initialize()
        console.log('✅ OIDC service initialized successfully')
      } else {
        console.log('⚠️  OIDC service not configured - local auth only')
        console.log('💡 Set AUTHENTIK_CLIENT_ID and AUTHENTIK_CLIENT_SECRET to enable OIDC')
      }
    } catch (error) {
      console.error('❌ Failed to initialize OIDC service:', error)
      console.log('⚠️  Continuing with local authentication only')
    }

    // Provision Authentik M2M clients (idempotent; errors are non-fatal)
    await provisionM2MClients()

    // Install the OpenFeature/Unleash provider. Non-fatal: on failure flags
    // fall back to their in-code fail-safe defaults.
    await initFeatureFlags('fuzefront-host')

    // FF-EPIC-09-S1 — idempotently ensure the seeded root portal exists. Runs
    // regardless of the multi-tenant-portals flag (it only creates dormant
    // rows nothing reads while the flag is off). Non-fatal: on a completely
    // fresh install (no users yet) this self-heals on a later boot; any other
    // failure (e.g. the AC4 orphaned-root-portal case) is logged, not fatal —
    // it must never block the whole platform from starting.
    try {
      const root = await ensureRootPortal()
      console.log(
        root
          ? `✅ Root portal ensured (${root.id})`
          : 'ℹ️  Root portal not seeded yet (no users exist)'
      )
    } catch (error) {
      console.error('⚠️  ensureRootPortal failed (non-fatal):', error)
    }

    // Push the environment-level Permit policy (resources/actions/roles from
    // permit/schema.ts, incl. the ReBAC Organization.parent relation and the
    // derived `org-admin` role). This was previously reachable ONLY via
    // `npm run permit:schema` and the test suite, so a schema change reached
    // Permit only when somebody remembered to run it — and the derived role the
    // org hierarchy depends on could silently not exist in the environment.
    // Non-fatal: Permit being unreachable must not stop the platform booting;
    // authorization already fails closed.
    try {
      const status = await syncPermitSchemaFromRegistry(
        permitClient as any,
        loadLegacyProductPolicies()
      )
      console.log(
        `✅ Permit schema synced (${status.resources} resources, ${status.roles} roles, ` +
          `${status.registeredProducts.length} registered product(s))`
      )
      // Fail-soft is right here — the platform must boot even if Permit or the
      // registry is down — but the outcome is now recorded and served on /health,
      // so "the sync quietly dropped every product policy" is an observable state
      // and not just a line that scrolled past in a pod log.
      if (status.outcome !== 'ok') {
        console.error(
          `⚠️  Permit schema sync degraded (${status.outcome}) — registered product ` +
            `policies were NOT applied; affected products have no roles in Permit. ` +
            `See GET /health → permit.`
        )
      }
    } catch (error) {
      console.error('⚠️  Permit schema sync failed (non-fatal):', error)
    }

    // Grant the ReBAC `org-admin` role on the ROOT organization to platform
    // administrators. Without a grant at the root there is nothing for the
    // schema's parent→child derivation to derive FROM, so wiring the hierarchy
    // alone would still leave staff unable to administer tenants.
    // Non-fatal for the same reason as above.
    try {
      const granted = await ensureRootOrgAdmins()
      console.log(
        granted.length > 0
          ? `✅ Root org-admin ensured for ${granted.length} administrator(s)`
          : 'ℹ️  No platform administrators to grant root org-admin to yet'
      )
    } catch (error) {
      console.error('⚠️  ensureRootOrgAdmins failed (non-fatal):', error)
    }

    // Start consuming billing.subscription.changed to project plan-tier/status
    // onto users/organizations. Non-fatal + no-op when KAFKA_BROKERS is unset.
    await startBillingProjection()

    const portNumber = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT
    const availablePort = await findAvailablePort(portNumber)

    if (availablePort !== portNumber) {
      console.log(
        `🔄 Original port ${portNumber} was busy, using port ${availablePort} instead`
      )
    }

    httpServer.listen(availablePort, () => {
      console.log(
        `🚀 FuzeFront backend server running on port ${availablePort}`
      )
      console.log(
        `🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`
      )
      console.log(`📡 WebSocket server ready`)
      console.log(
        `📚 API Documentation: http://localhost:${availablePort}/api-docs`
      )
      console.log(`💓 Health Check: http://localhost:${availablePort}/health`)
      console.log(`🗄️  Database: PostgreSQL (shared-postgres)`)
      
      // Log authentication methods available
      const authMethods = ['Local Database']
      if (oidcService.isConfigured()) {
        authMethods.push('OIDC (Authentik)')
      }
      console.log(`🔐 Authentication: ${authMethods.join(', ')}`)

      // Update PORT variable for other parts of the app
      process.env.PORT = availablePort.toString()
    })

    httpServer.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${availablePort} is already in use`)
        console.log(
          '💡 This might happen if another instance is already running'
        )
        console.log('💡 Try stopping other instances or use a different port')
        gracefulShutdown('EADDRINUSE')
      } else {
        console.error('❌ Server error:', err)
        gracefulShutdown('ServerError')
      }
    })
  } catch (error) {
    console.error('❌ Failed to start server:', error)
    console.log('💡 Please check if ports 3001-3010 are available')
    process.exit(1)
  }
}

// Start the server
startServer()

export default app
