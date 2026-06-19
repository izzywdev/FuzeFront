// FuzeFront applications-service — app registry, Module-Federation remotes,
// heartbeat, health, and Socket.IO. Owns the apps DDL via its own idempotent
// migration chain under knex_migrations_apps, and waits for the organizations
// table (created by security-service) before running migration 002's FK. Dual-
// serves alongside the old monolith until the Phase 3 cutover.
import dotenv from 'dotenv'
import { createServer } from 'http'
import path from 'path'
import {
  createExpressApp,
  attachErrorHandlers,
  initializeDatabase,
  checkDatabaseHealth,
  closeDatabase,
  waitForPostgres,
  ensureDatabase,
  runMigrations,
  runSeeds,
  initializeDatabaseConnection,
  configureDatabase,
  waitForTable,
} from '@fuzefront/core'

import appsRoutes from './routes/apps'
import { initializeSocketIO } from './sockets/socketHandler'

dotenv.config()

const PORT = process.env.PORT || 3003
const app = createExpressApp({ serviceName: 'applications-service' })
const httpServer = createServer(app)
const startTime = Date.now()

// Socket.IO lives here (applications-service owns /socket.io). Routes reach it
// via req.app.get('io'), so make it available on the app.
const io = initializeSocketIO(httpServer)
app.set('io', io)

app.use('/api/apps', appsRoutes)

const health = async (_req: any, res: any) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  const dbHealthy = await checkDatabaseHealth().catch(() => false)
  res.json({
    status: dbHealthy ? 'ok' : 'degraded',
    service: 'applications-service',
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
  console.log(`\n🛑 [applications-service] Received ${signal}. Shutting down...`)
  httpServer.close(() => {
    io.close(async () => {
      await closeDatabase().catch(() => undefined)
      process.exit(0)
    })
  })
  setTimeout(() => process.exit(1), 30000)
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

/**
 * Boot sequence with cross-service startup ordering: wait for Postgres, ensure
 * the DB exists, then wait for the `organizations` table (owned by security-
 * service) to exist BEFORE running our migrations — migration 002 adds an
 * organization_id FK to organizations. All in-process; no initContainer.
 */
async function startServer() {
  try {
    console.log('🔄 Starting FuzeFront applications-service...')
    const dbOptions = {
      migrationsTableName: 'knex_migrations_apps',
      migrationsDir: path.join(__dirname, 'migrations'),
      seedsDir: path.join(__dirname, 'seeds'),
    }
    configureDatabase(dbOptions)

    await waitForPostgres(30, 2000)
    await ensureDatabase()
    // Cross-service ordering: organizations must exist before our FK migration.
    await waitForTable('organizations', 60, 2000)
    await runMigrations(dbOptions)
    initializeDatabaseConnection(dbOptions)
    if (process.env.NODE_ENV !== 'production') {
      await runSeeds(dbOptions)
    }

    const portNumber = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT
    httpServer.listen(portNumber, () => {
      console.log(`🚀 applications-service running on port ${portNumber}`)
      console.log(`📡 Socket.IO server ready`)
    })
  } catch (error) {
    console.error('❌ [applications-service] Failed to start:', error)
    process.exit(1)
  }
}

startServer()

export default app
