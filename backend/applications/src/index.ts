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
import appInstallationsRoutes from './routes/app-installations'
import appRegistryRoutes from './routes/app-registry'
import portalCatalogRoutes from './routes/portal-catalog'
import { ensureBuiltins } from './app-registry/builtins'
import { initFeatureFlags } from './config/feature-flags'
import { initializeSocketIO } from './sockets/socketHandler'
import { configureIdentity } from '@izzywdev/fuzefront-identity'
import { startRefIndexProjection, stopRefIndexProjection } from './kafka/ref-index.consumer'
import { KnexRefIndexRepository } from './repositories/ref-index.repository'

dotenv.config()

const PORT = process.env.PORT || 3003
const app = createExpressApp({ serviceName: 'applications-service' })
const httpServer = createServer(app)
const startTime = Date.now()

// Socket.IO lives here (applications-service owns /socket.io). Routes reach it
// via req.app.get('io'), so make it available on the app.
const io = initializeSocketIO(httpServer)
app.set('io', io)

// Installation routes mount FIRST so `/installed`, `/:id/installations` and
// `/:id/install*` resolve before appsRoutes' own `/:id` handlers. Express falls
// through to appsRoutes for every path this router does not define.
//
// These live HERE, not on fuzefront-backend, because the ingress routes
// `/api/apps` (Prefix) to this service and only the remaining `/api` to the
// backend — and applicationsService.enabled is true in both values-local.yaml
// and values-prod.yaml. The route must be implemented by whichever service owns
// the path prefix, which is what scripts/check-route-ownership.mjs now enforces.
app.use('/api/apps', appInstallationsRoutes)
app.use('/api/apps', appsRoutes)
// Frozen versioned app-registry contract surface (services/app-registry-service/
// openapi.yaml) — mounted ALONGSIDE the legacy /api/apps for back-compat.
app.use('/api/v1/app-registry', appRegistryRoutes)
// FF-EPIC-12-S3 — portal app-catalog admin API. Mounted at the SAME prefix so
// it rides the existing host-backend proxy/route-ownership entry for
// /api/v1/app-registry with no new wiring (see routes/portal-catalog.ts).
app.use('/api/v1/app-registry', portalCatalogRoutes)

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
      await stopRefIndexProjection().catch(() => undefined)
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
 * service) AND the `portals` table (owned by the host backend, FF-EPIC-09) to
 * exist BEFORE running our migrations — migration 002 adds an organization_id
 * FK to organizations, and migration 007 (FF-EPIC-12-S1) adds a portal_id FK
 * to portals. All in-process; no initContainer.
 */
async function startServer() {
  try {
    console.log('🔄 Starting FuzeFront applications-service...')

    // Step 5 (FFRNT-185): configure the dual-accept window so that
    // assertRef / parseId accept bare UUIDs for entity types whose stored rows
    // predate the TypeID wire form. Flag `fuzefront.identity.prefixed-ids`
    // (step 4) controls whether RESPONSES emit TypeID form; these types remain
    // in legacyUuidTypes until their row backfill is complete.
    configureIdentity({
      legacyUuidTypes: new Set([
        'organization',
        'membership',
        'invitation',
        'session',
        'mfaFactor',
        'user',
        'app',
        'portal',
      ]),
    })
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
    // FF-EPIC-12-S1 — portal_apps.portal_id FKs into portals (host backend,
    // migration 012). Mirrors the organizations wait above exactly.
    await waitForTable('portals', 60, 2000)
    await runMigrations(dbOptions)
    initializeDatabaseConnection(dbOptions)
    if (process.env.NODE_ENV !== 'production') {
      await runSeeds(dbOptions)
    }
    // Built-in apps (e.g. Clock) are provisioned idempotently on EVERY boot
    // (production included) so they appear in the menu out of the box, separate
    // from the dev-only demo seeds above. Best-effort: never aborts startup.
    await ensureBuiltins().catch(err =>
      console.error('⚠️  [applications-service] ensureBuiltins failed:', err)
    )

    // Install the OpenFeature/Unleash provider so app-registry flags actually
    // consult Unleash. Non-fatal: on failure they keep their in-code fail-safe
    // defaults (release OFF / kill-switch ON).
    await initFeatureFlags('applications-service')

    // Projects identity.org.* events into app_ref_index so assertRefExists can
    // answer at request time without an RPC. Non-fatal + no-op when KAFKA_BROKERS unset.
    const refIndexStore = new KnexRefIndexRepository(db)
    await startRefIndexProjection(refIndexStore)

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
