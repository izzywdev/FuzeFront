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
import securityRoutes from './routes/security'
import authzRoutes from './routes/authz'
import portalsRoutes from './routes/portals'
import organizationsRoutes from './routes/organizations'
import invitationsRoutes from './routes/invitations'
import internalRoutes from './routes/internal'
import apiTokensRoutes, { orgTokensRouter } from './routes/api-tokens'
import { tokenAuthRateLimiter } from './middleware/api-token-auth'
import { initializeAllTenants } from './services/oidc'
import { tenantContext } from './middleware/tenant-context'
import { startOutboxRelayIfConfigured } from './services/outboxRelay'
import { initFeatureFlags } from './utils/feature-flags'
import { configureIdentity } from '@izzywdev/fuzefront-identity'
import type { OutboxRelayHandle } from '@fuzefront/core'

dotenv.config()

// Transactional-outbox relay handle (null when KAFKA_BROKERS is unset).
let outboxRelay: OutboxRelayHandle | null = null

const PORT = process.env.PORT || 3002
const app = createExpressApp({ serviceName: 'security-service' })
// Behind the k8s ingress every request otherwise carries the ingress IP —
// trust the first proxy hop so req.ip (rate limiting, auth logs) reflects
// the real client from X-Forwarded-For.
app.set('trust proxy', 1)
const httpServer = createServer(app)
const startTime = Date.now()

// ── Identity tenant resolution ───────────────────────────────────────────────
// Resolves the tenant from the request host and makes it ambient for everything
// downstream. MUST be mounted before any identity-bearing router: the handlers
// and the services beneath them read their Authentik configuration from the
// resolved tenant, and in multi-tenant mode there is no default to fall back on.
//
// Mounted on the identity surfaces ONLY — /health, /metrics and /internal are
// deliberately excluded. Those are cluster-internal or probe traffic that
// arrives on Service DNS and pod IPs rather than a declared tenant host, so
// requiring a tenant there would fail liveness/readiness the moment a second
// tenant is declared.
//
// In legacy single-tenant mode resolution always succeeds, so mounting this is
// a no-op for existing deployments.
app.use('/api/v1/security', tenantContext)
app.use('/api/auth', tenantContext)
app.use('/api/organizations', tenantContext)
app.use('/api/invitations', tenantContext)
app.use('/api/tokens', tenantContext)

// Provider-agnostic Security API (AuthN surface). New consumers use this.
app.use('/api/v1/security', securityRoutes)
// Provider-agnostic Security API (AuthZ surface) — /authz/* + /tenants/*,
// implemented purely against the AuthorizationProvider contract (Permit hidden).
app.use('/api/v1/security', authzRoutes)
// Portal CRUD as org-tree operations (FF-EPIC-17-S7) — /portals/*. Behind
// `fuzefront.platform.multi-tenant-portals` (default OFF); platform-admin-only.
app.use('/api/v1/security', portalsRoutes)
// Domain routes (identical paths to the monolith). These remain the working,
// prod-tested `/api/auth/*` surface; they are the DEPRECATED compatibility
// layer that the SPA migrates OFF onto `/api/v1/security/*`. Converting them
// into thin shims that delegate into the new provider is scheduled as a
// follow-up (kept intact here to avoid regressing the live login path).
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
    outboxRelay?.stop()
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

    // Step 5 (FFRNT-185): configure the dual-accept window so that
    // assertRef / parseId accept bare UUIDs for entity types whose stored rows
    // were written before the TypeID wire form was adopted. The flag
    // `fuzefront.identity.prefixed-ids` (step 4) controls whether RESPONSES
    // emit TypeID form; these types stay in legacyUuidTypes until the row
    // backfill is complete and the window is deliberately closed.
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
    // Original chain keeps the original knex_migrations table; dirs resolve to
    // THIS service's compiled output (dist/migrations) in prod, src in dev.
    await initializeDatabase({
      migrationsTableName: 'knex_migrations',
      migrationsDir: path.join(__dirname, 'migrations'),
      seedsDir: path.join(__dirname, 'seeds'),
    })

    // Drain event_outbox → Kafka. Starts after the DB connection is live so the
    // relay's `db` singleton is initialized; a no-op when KAFKA_BROKERS is unset.
    outboxRelay = startOutboxRelayIfConfigured()

    // Install the OpenFeature/Unleash provider. Non-fatal: on failure flags
    // (e.g. `fuzefront.identity.root-membership`) fall back to their in-code
    // fail-safe defaults — see utils/rootMembershipFlag.ts.
    await initFeatureFlags('fuzefront-security')

    try {
      console.log('🔧 Initializing OIDC service(s)...')
      // One client per configured tenant, each against its OWN Authentik.
      // initializeAllTenants warms them in parallel and starts each one's
      // self-heal loop; a tenant whose Authentik is down is logged and left to
      // the background retry rather than blocking the others from coming up.
      await initializeAllTenants()
      console.log('✅ OIDC service(s) initialized')
    } catch (error) {
      console.error('❌ Failed to initialize OIDC service(s):', error)
      console.log('⚠️  Continuing with local authentication only')
    }

    // If OIDC is configured but the initial discovery failed (e.g. Authentik
    // blueprints not yet applied at startup, or Authentik briefly down), keep
    // retrying in the background for the LIFE OF THE PROCESS with capped
    // exponential backoff (1s -> 60s) — not a bounded window. A bounded retry
    // (previously 30 attempts / 5 min) meant that if Authentik was still down
    // 5 minutes after boot, OIDC init failed PERMANENTLY: every subsequent
    // signup/login 401'd with "OIDC is not configured/initialized" until a
    // human ran `kubectl rollout restart`. This self-heals on its own once
    // Authentik comes back, with zero request traffic required. Requests
    // arriving in the meantime also get a lazy re-init attempt via
    // getOidcService().ensureInitialized() (see routes/auth.ts,
    // authentikPassword.ts, AuthentikIdentityProvider.ts) — both paths share
    // the same in-flight promise + cooldown so they never double-fire against
    // Authentik.
    //
    // The retry loops are started by initializeAllTenants() above, per tenant,
    // so there is no separate kick-off here. Each tenant self-heals
    // independently: one tenant's Authentik being down neither blocks nor
    // resets another's.

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

