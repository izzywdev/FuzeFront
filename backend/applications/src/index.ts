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
  db,
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

// BUILD IDENTITY, echoed on EVERY response.
//
// `values-prod.yaml` records the image tag GitOps ASKED for. It is not evidence
// about what is running: a rollout that never completes (unschedulable pod,
// crash-looping new ReplicaSet, a failed Argo sync) leaves the PREVIOUS pods
// answering every healthcheck with a green 200 while the requested image is
// never pulled. Nothing in this repo could see that difference, and the cost
// was real — migration 012 (merged 2026-09-01) and 013 (merged 2026-09-07) had
// both still not executed on 2026-09-07, so `fuzesocial` was serving as an
// iframe and the duplicate `fuzesales`/`fuzeservice` tiles were still in the
// portal, six days after the fix for each had shipped green.
//
// A RESPONSE HEADER rather than a new route, deliberately: it needs no route
// ownership entry, no host-backend proxy change and no new auth surface, and it
// therefore rides `GET /api/v1/app-registry/apps` — an endpoint the census
// already authenticates to and calls. `scripts/check-portal-federation-health.mjs
// --expected-build` compares it against values-prod.yaml and fails when they
// diverge, which is what turns a silent six-day stall into a red run.
//
// The value is stamped at image build time (Dockerfile ARG BUILD_SHA <- release.yml).
// It is NOT read per-request: an operator setting BUILD_SHA in the Deployment env
// would be describing the pod spec, not the image, which is the very confusion
// this exists to remove.
const BUILD_SHA = process.env.BUILD_SHA || 'unknown'
app.use((_req: any, res: any, next: any) => {
  res.setHeader('X-Fuze-Build', BUILD_SHA)
  next()
})

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
    build: BUILD_SHA,
    environment: process.env.NODE_ENV || 'development',
    database: { status: dbHealthy ? 'connected' : 'disconnected' },
  })
}
app.get('/health', health)
app.get('/api/health', health)

// ── READINESS: /ready. 503 when a dependency is down. ───────────────────────
//
// THE BUG THIS FIXES. deploy/helm/fuzefront/templates/applications.yaml's
// readinessProbe has pointed at `path: /ready` (not /health) since that
// template was written, with a comment explaining exactly why: "readiness
// must reflect dependency state so a degraded backend leaves the Service
// endpoints AND Argo's built-in Deployment assessment reports Degraded."
// Correct intent — but this service never implemented the route. Every
// request to /ready has always 404'd via attachErrorHandlers' catch-all, so
// the readinessProbe has ALWAYS failed for every pod, on every revision.
//
// A pod's readinessProbe path is fixed at pod-template time (a new Deployment
// revision does not retroactively change an already-Running pod's probe), so
// this is asymmetric: pods created back when the chart's probe pointed at
// /health (before that template edit) are still passing their old probe and
// serving traffic; every pod created SINCE is permanently unready — excluded
// from the Service endpoints, invisible to any black-box HTTP check, with
// Argo CD reporting the Application Degraded/Progressing the whole time. A
// RollingUpdate Deployment never scales down the old ReplicaSet until the new
// one is Ready, so the old pods just keep serving forever. This explains why
// a new pod that DOES successfully boot is invisible from outside the
// cluster (#1137) — httpServer.listen() (see startServer() below) only runs
// after migrations succeed, so any pod that reaches this route already
// applied them. It does NOT by itself prove migrations 013/014 have actually
// applied in prod: a pod could equally be failing to reach this route at all
// (crash-looping earlier in startServer(), e.g. on a migration exception),
// which would be invisible for the same reason — no traffic, no black-box
// signal — but is a different failure than "ready and just never selected".
// Telling those two apart needs `kubectl logs --previous` / `get rs`, not
// something this route can determine about itself.
//
// Same split as backend/src/index.ts's /ready (host backend): liveness (/health)
// stays 200-always so a DB blip never turns into a restart loop; readiness
// reflects the real dependency state, matching the chart's own documented intent.
app.get('/ready', async (_req: any, res: any) => {
  const dbHealthy = await checkDatabaseHealth().catch(() => false)
  res.status(dbHealthy ? 200 : 503).json({
    status: dbHealthy ? 'ok' : 'degraded',
    service: 'applications-service',
    database: { status: dbHealthy ? 'connected' : 'disconnected' },
  })
})

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

    // Step 5 (FFRNT-185): dual-accept windows closed.
    // All entity types now use mintId() for creation and store bare UUIDs;
    // the prefixed-ids flag is ON in prod. No legacy bare-UUID references
    // need to be accepted at the request boundary.
    configureIdentity({ legacyUuidTypes: new Set() })
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

// Guarded so `app` can be imported (e.g. by a test asserting against the
// REAL mounted routes, incl. /ready -- see tests/ready.test.ts) without
// triggering the boot sequence's DB waits / migrations / process.exit(1) on
// failure. Same pattern already used by backend/src/seeds/
// register-platform-apps.ts and backend/src/permit/sync-permit-schema.ts.
// `node dist/index.js` (the Dockerfile's actual entrypoint) still runs it,
// since require.main === module is true there.
if (require.main === module) {
  startServer()
}

export default app
