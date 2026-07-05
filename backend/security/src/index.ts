// FuzeFront security-service — identity, organizations, provisioning, OIDC,
// Permit. Runs the original 001-009 migration chain against the existing
// `knex_migrations` table (002/006 are no-op tombstones; applications-service
// owns apps DDL). Dual-serves alongside the old monolith until Phase 3 cutover.
import dotenv from 'dotenv'
import { createServer } from 'http'
import {
  createExpressApp,
  attachErrorHandlers,
  initializeDatabase,
  checkDatabaseHealth,
  closeDatabase,
} from '@fuzefront/core'
import path from 'path'

import authRoutes from './routes/auth'
import organizationsRoutes from './routes/organizations'
import invitationsRoutes from './routes/invitations'
import internalRoutes from './routes/internal'
import apiTokensRoutes, { orgTokensRouter } from './routes/api-tokens'
import { tokenAuthRateLimiter } from './middleware/api-token-auth'
import { oidcService } from './services/oidc'

dotenv.config()

const PORT = process.env.PORT || 3002
const app = createExpressApp({ serviceName: 'security-service' })
const httpServer = createServer(app)
const startTime = Date.now()

// Domain routes (identical paths to the monolith).
app.use('/api/auth', authRoutes)
// Org-token sub-route: GET /api/organizations/:orgId/tokens (rate-limited, mounted BEFORE
// organizationsRoutes so the specific /:orgId/tokens path cannot be shadowed by any future wildcard)
app.use('/api/organizations', tokenAuthRateLimiter, orgTokensRouter)
app.use('/api/organizations', organizationsRoutes)
app.use('/api/invitations', invitationsRoutes)
// API token CRUD — rate limiter applied to all /api/tokens/* routes
app.use('/api/tokens', tokenAuthRateLimiter, apiTokensRoutes)
// Cluster-internal only — NEVER exposed through the public ingress.
app.use('/internal', internalRoutes)

const health = async (_req: any, res: any) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  const dbHealthy = await checkDatabaseHealth().catch(() => false)
  res.json({
    status: dbHealthy ? 'ok' : 'degraded',
    service: 'security-service',
    timestamp: new Date().toISOString(),
    uptime,
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    database: { status: dbHealthy ? 'connected' : 'disconnected' },
  })
}
app.get('/health', health)
app.get('/api/health', health)

attachErrorHandlers(app)

function gracefulShutdown(signal: string) {
  console.log(`\n🛑 [security-service] Received ${signal}. Shutting down...`)
  httpServer.close(async () => {
    await closeDatabase().catch(() => undefined)
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 30000)
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

async function startServer() {
  try {
    console.log('🔄 Starting FuzeFront security-service...')
    const isProduction = process.env.NODE_ENV === 'production'
    // Original chain keeps the original knex_migrations table; dirs resolve to
    // THIS service's compiled output (dist/migrations) in prod, src in dev.
    await initializeDatabase({
      migrationsTableName: 'knex_migrations',
      migrationsDir: path.join(__dirname, 'migrations'),
      seedsDir: path.join(__dirname, 'seeds'),
    })

    try {
      console.log('🔧 Initializing OIDC service...')
      if (oidcService.isConfigured()) {
        await oidcService.initialize()
        console.log('✅ OIDC service initialized successfully')
      } else {
        console.log('⚠️  OIDC service not configured - local auth only')
      }
    } catch (error) {
      console.error('❌ Failed to initialize OIDC service:', error)
      console.log('⚠️  Continuing with local authentication only')
    }

    // If OIDC is configured but the initial discovery failed (e.g. Authentik
    // blueprints not yet applied at startup), retry in the background every
    // 10 seconds for up to 5 minutes. This makes the E2E stack reliable:
    // the backend starts before OIDC is ready, but self-heals once it is.
    if (oidcService.isConfigured() && !oidcService.isInitialized()) {
      const oidcRetry = async () => {
        const MAX_ATTEMPTS = 30 // 30 × 10s = 5 min
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10_000))
          try {
            await oidcService.initialize()
            console.log(`✅ OIDC service initialized on retry (attempt ${attempt})`)
            return
          } catch {
            if (attempt < MAX_ATTEMPTS) {
              console.log(`⚠️  OIDC retry ${attempt}/${MAX_ATTEMPTS} failed — will try again`)
            } else {
              console.error('❌ OIDC service failed to initialize after all retries')
            }
          }
        }
      }
      oidcRetry() // fire-and-forget; server is already listening
    }

    const portNumber = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT
    httpServer.listen(portNumber, () => {
      console.log(`🚀 security-service running on port ${portNumber}`)
    })
  } catch (error) {
    console.error('❌ [security-service] Failed to start:', error)
    process.exit(1)
  }
}

startServer()

export default app

