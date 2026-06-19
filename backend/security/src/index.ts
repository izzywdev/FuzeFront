// FuzeFront security-service — Phase 0 scaffold (health only on :3002).
// Domain routes + migrations are wired in Phase 1.
import dotenv from 'dotenv'
import { createServer } from 'http'
import {
  createExpressApp,
  attachErrorHandlers,
  initializeDatabaseConnection,
  checkDatabaseHealth,
  waitForPostgres,
  closeDatabase,
} from '@fuzefront/core'

dotenv.config()

const PORT = process.env.PORT || 3002
const app = createExpressApp({ serviceName: 'security-service' })
const httpServer = createServer(app)
const startTime = Date.now()

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
    await waitForPostgres(30, 2000)
    initializeDatabaseConnection({ migrationsTableName: 'knex_migrations' })
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
