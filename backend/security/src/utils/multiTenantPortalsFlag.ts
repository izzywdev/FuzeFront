/**
 * FF-EPIC-17-S7 — gates the org-tree portal CRUD endpoints
 * (`/api/v1/security/portals*`) behind `fuzefront.platform.multi-tenant-portals`,
 * the documented master switch for the multi-tenant portals feature
 * (`packages/feature-flags/flag-registry.yaml`, FF-EPIC-09-S4). This is the
 * SAME flag key the monolith's `backend/src/utils/portalFlag.ts` reads for the
 * portal bootstrap surface — reused rather than minting a narrower
 * portal-CRUD-specific flag, because this story's endpoints are exactly the
 * "master-admin portal CRUD + provisioning pipeline" the registry entry
 * already calls out as a gated surface.
 *
 * Type: release. Owner: platform team (per flag-registry.yaml). Default: OFF.
 * Removal criterion: when multi-tenant portals are GA and enabled for 100% of
 * orgs — drop the flag and the pre-epic code path (registry-authoritative).
 *
 * Security-service-local copy of the flag reader — mirrors
 * `utils/employeeFlag.ts` / `utils/memberDirectoryFlag.ts`'s lazy-require
 * OpenFeature pattern (NOT the monolith's `portalFlag.ts`, which additionally
 * caches a per-request decision on `req.portalsFlagEnabled` for ITS OWN
 * consumers; this service has no equivalent request-scoped cache today, so a
 * plain per-call evaluation — same as the other *Flag.ts readers in this
 * service — is the right-sized copy).
 *
 * Read via @fuzefront/feature-flags (OpenFeature) per the `feature-flags`
 * skill — never a hand-wired Unleash/OpenFeature call. Loaded lazily so a
 * missing/unbuilt package degrades to the fail-safe default (OFF) rather than
 * crashing route/service modules at import time.
 */

export const MULTI_TENANT_PORTALS_FLAG = 'fuzefront.platform.multi-tenant-portals'

export interface MultiTenantPortalsFlagContext {
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
 * Evaluates the multi-tenant-portals flag for the current request/operation.
 * NEVER throws — any failure (package absent, provider unreachable,
 * evaluation error) degrades to the release-flag fail-safe default: OFF
 * (the portal CRUD routes render 404, exactly as if they did not exist).
 */
export async function isMultiTenantPortalsEnabled(
  ctx: MultiTenantPortalsFlagContext = {}
): Promise<boolean> {
  const client = loadFlagsClient()
  if (!client) return false

  const context = {
    environment:
      ctx.environment ??
      (process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local'),
    app: 'fuzefront-security',
    ...(ctx.userId ? { userId: ctx.userId } : {}),
  }

  try {
    return await client.getBooleanValue(MULTI_TENANT_PORTALS_FLAG, false, context)
  } catch {
    return false
  }
}
