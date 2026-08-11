/**
 * Portals Directory (backend slice S1) — the `fuzefront.platform.portals-directory`
 * flag: gates the two NEW response fields (`identityMode`, `launchUrl`) that
 * `GET /api/v1/admin/portals` adds to the master-admin portal fleet list.
 *
 * Type: release. Owner: backend-engineer (platform). Default: OFF — when OFF,
 * `GET /api/v1/admin/portals`'s response is byte-identical to the pre-existing
 * shape (neither new field is emitted). Removal criterion: delete this flag +
 * the OFF-path field-stripping branch in `routes/adminPortals.ts` once the
 * portals directory UI (S3) is rolled out to 100% and the flag-OFF path is no
 * longer exercised in prod.
 *
 * NOTE: this flag is rollout convenience only — it gates response SHAPE, not
 * authorization. `GET /api/v1/admin/portals` stays `requireRole(['admin'])`-
 * gated in BOTH flag states; this flag never widens who may call the route or
 * which portals they see.
 *
 * Read via @fuzefront/feature-flags (OpenFeature) per the `feature-flags`
 * skill — never a hand-wired Unleash/OpenFeature call. Loaded lazily (mirrors
 * utils/portalFlag.ts / utils/rootMembershipFlag.ts) so a missing/unbuilt
 * package degrades to the fail-safe default (OFF) rather than crashing
 * route modules at import time.
 */

export const PORTALS_DIRECTORY_FLAG = 'fuzefront.platform.portals-directory'

export interface PortalsDirectoryFlagContext {
  userId?: string
  organizationId?: string
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
 * Evaluates the portals-directory flag for the current request. NEVER
 * throws — any failure (package absent, provider unreachable, evaluation
 * error) degrades to the release-flag fail-safe default: OFF (today's
 * `GET /api/v1/admin/portals` shape, unchanged).
 */
export async function isPortalsDirectoryEnabled(
  ctx: PortalsDirectoryFlagContext = {}
): Promise<boolean> {
  const client = loadFlagsClient()
  if (!client) return false

  const context = {
    environment:
      ctx.environment ??
      (process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local'),
    app: 'fuzefront-backend',
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
  }

  try {
    return await client.getBooleanValue(PORTALS_DIRECTORY_FLAG, false, context)
  } catch {
    return false
  }
}
