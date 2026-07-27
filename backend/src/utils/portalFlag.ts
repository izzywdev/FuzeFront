/**
 * Master feature flag for the multi-tenant-portal capability
 * (FF-EPIC-09-S4 / FF-EPIC-10). RELEASE flag — default OFF. Gates ALL new
 * server behavior introduced by EPIC-09/EPIC-10: portal context resolution,
 * the public boot endpoint, JWT/session portal binding, and (a later PR) the
 * master-admin portal CRUD + provisioning pipeline.
 *
 * Owner: backend-engineer (platform). Removal criterion: delete this flag +
 * both code branches once multi-tenant portals are 100% rolled out and the
 * flag-OFF path is no longer exercised in prod.
 *
 * Read via @fuzefront/feature-flags (OpenFeature) per the `feature-flags`
 * skill — never a hand-wired Unleash/OpenFeature call. Loaded lazily (like
 * src/routes/flags.ts) so a missing/unbuilt package degrades to the in-code
 * default (OFF) rather than crashing route/middleware modules at import time.
 */

export const MULTI_TENANT_PORTALS_FLAG = 'fuzefront.platform.multi-tenant-portals'

export interface PortalFlagContext {
  userId?: string
  environment?: string
}

interface FlagsClient {
  getBooleanValue(
    key: string,
    def: boolean,
    ctx?: Record<string, unknown>
  ): Promise<boolean>
}

function loadFlagsClient(): FlagsClient | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@fuzefront/feature-flags')
    return typeof mod.getClient === 'function' ? mod.getClient() : null
  } catch {
    return null
  }
}

/**
 * Evaluates the master flag for the current request/operation. NEVER throws —
 * any failure (package absent, provider unreachable, evaluation error)
 * degrades to the release-flag fail-safe default: OFF.
 */
export async function isMultiTenantPortalsEnabled(
  ctx: PortalFlagContext = {}
): Promise<boolean> {
  const client = loadFlagsClient()
  if (!client) return false

  const context = {
    environment:
      ctx.environment ??
      (process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local'),
    app: 'fuzefront-backend',
    ...(ctx.userId ? { userId: ctx.userId } : {}),
  }

  try {
    return await client.getBooleanValue(MULTI_TENANT_PORTALS_FLAG, false, context)
  } catch {
    return false
  }
}
