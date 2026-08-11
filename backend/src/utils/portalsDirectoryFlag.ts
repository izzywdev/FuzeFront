/**
 * Portals Directory (backend slices S1 + S5) — the
 * `fuzefront.platform.portals-directory` flag: gates the NEW response fields
 * (`identityMode`, `launchUrl`, and — as of S5 — `canManage`/`canOpen`) that
 * `GET /api/v1/admin/portals` adds to the master-admin portal fleet list,
 * AND (as of S5) the per-portal read-vs-manage authorization refinement
 * described below.
 *
 * Type: release. Owner: backend-engineer (platform). Default: OFF — when OFF,
 * `GET /api/v1/admin/portals`'s response AND authorization are byte-identical
 * to the pre-existing (pre-S1) shape/gate (no new fields emitted, blanket
 * `requireRole(['admin'])`). Removal criterion: delete this flag + the
 * OFF-path field-stripping/blanket-gate branch in `routes/adminPortals.ts`
 * once the portals directory UI (S3, S6) is rolled out to 100% and the
 * flag-OFF path is no longer exercised in prod.
 *
 * NOTE (updated for backend slice S5, read-vs-no-access refinement): this
 * flag ALSO gates authorization now, not just response shape. When OFF,
 * `GET /api/v1/admin/portals` stays `requireRole(['admin'])`-gated exactly
 * as before. When ON, the blanket admin-role gate is replaced by a
 * per-portal Permit `read`/`manage` check on each portal's owning
 * organization (`utils/portalReadManageCapabilities.ts`) — a caller with
 * `read` (but not `manage`) authority now gets 200 with read-only rows
 * instead of a hard 403. Real authorization is still Permit's, never this
 * flag's: the flag only decides whether the NEW, more granular Permit check
 * runs at all, and a portal the caller cannot `read` is never returned in
 * either state (fail-closed, BOLA-safe). See `routes/adminPortals.ts`'s
 * `GET /` handler for the full flag-branch contract.
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
