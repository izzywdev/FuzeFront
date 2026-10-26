/**
 * The `fuzefront.identity.org-list-direct-only-kill-switch` flag: the break-glass
 * for the owner-decided org-visibility filter on `GET /api/organizations`
 * (services/orgListVisibility.ts).
 *
 * The decision (owner, 2026-10-26): the organizations list a user sees contains
 * ONLY orgs where the user holds a DIRECT membership row. The FuzeFront root org
 * is hidden from everyone but platform staff (root-membership made every user a
 * `member` of root, so it would otherwise show for everyone), and ancestors the
 * user is not a direct member of are never pulled in structurally.
 *
 * Type: ops-kill-switch. Default: ON — the filter is the intended behavior, and
 * an unreachable/unconfigured flag store must FAIL SAFE, i.e. keep the filter
 * (and therefore not leak the root org). Flipping it OFF restores the previous
 * list (direct memberships + the root org by id) without a redeploy.
 * Owner: backend-engineer (identity). Removal criterion: delete the flag and
 * its OFF branch once the filtered list has been stable in prod and the
 * break-glass is no longer wanted; the kill-switch is otherwise long-lived.
 *
 * NOTE: rollout/visibility convenience only. It never replaces a `permit.check`:
 * the list endpoint is read-scoped to the caller's own memberships and every
 * org-scoped mutation keeps its own authorization.
 *
 * Read via @fuzefront/feature-flags (OpenFeature) per the `feature-flags`
 * skill, loaded lazily (mirrors utils/rootMembershipFlag.ts) so a missing or
 * unbuilt package degrades to the fail-safe default (ON) instead of crashing
 * the route module at import time.
 */

export const ORG_LIST_DIRECT_ONLY_FLAG =
  'fuzefront.identity.org-list-direct-only-kill-switch'

export interface OrgListDirectOnlyFlagContext {
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
 * Evaluates the kill-switch for the current request. NEVER throws — every
 * failure mode (package absent, provider unreachable, evaluation error)
 * resolves to the kill-switch fail-safe default: ON (filter active).
 */
export async function isOrgListDirectOnlyEnabled(
  ctx: OrgListDirectOnlyFlagContext = {}
): Promise<boolean> {
  const client = loadFlagsClient()
  if (!client) return true

  const context = {
    environment:
      ctx.environment ??
      (process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local'),
    app: 'fuzefront-security',
    ...(ctx.userId ? { userId: ctx.userId } : {}),
  }

  try {
    return await client.getBooleanValue(ORG_LIST_DIRECT_ONLY_FLAG, true, context)
  } catch {
    return true
  }
}
