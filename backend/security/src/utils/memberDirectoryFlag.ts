/**
 * FF-EPIC-17-S5 — the `fuzefront.identity.member-directory` flag: gates the
 * NEW `GET /api/organizations/:id/directory` endpoint (the root/portal
 * member directory — the paginated, server-side-searchable list of ALL
 * users of a tenant-root org; see `packages/security/openapi.yaml`'s
 * `listOrganizationDirectory` operation and
 * `docs/planning/epics/EPIC-17-personal-identity-portal-employee-
 * reconciliation.md` Feature 5.2).
 *
 * Type: release. Owner: backend-engineer (identity). Default: OFF — the
 * endpoint did not exist before this story, so OFF renders it exactly as if
 * absent (404), zero regression to any existing surface. Removal criterion:
 * delete this flag once the member-directory UI (frames-first flow,
 * `design/frames/member-directory/**`) is rolled out to 100% and the
 * flag-OFF (disabled) path is no longer exercised in prod.
 *
 * NOTE: this flag is rollout convenience only — it never replaces the real
 * authorization check inside the route (org owner/admin, or Employee via the
 * ReBAC `org-admin`-on-root grant). An id is never a capability; the flag
 * only decides whether the route exists at all in this environment yet.
 *
 * Read via @fuzefront/feature-flags (OpenFeature) per the `feature-flags`
 * skill — never a hand-wired Unleash/OpenFeature call. Loaded lazily (mirrors
 * utils/rootMembershipFlag.ts / utils/employeeFlag.ts) so a missing/unbuilt
 * package degrades to the fail-safe default (OFF) rather than crashing
 * route/service modules at import time.
 */

export const MEMBER_DIRECTORY_FLAG = 'fuzefront.identity.member-directory'

export interface MemberDirectoryFlagContext {
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
 * Evaluates the member-directory flag for the current request. NEVER
 * throws — any failure (package absent, provider unreachable, evaluation
 * error) degrades to the release-flag fail-safe default: OFF (the endpoint
 * behaves as if it does not exist — 404).
 */
export async function isMemberDirectoryEnabled(
  ctx: MemberDirectoryFlagContext = {}
): Promise<boolean> {
  const client = loadFlagsClient()
  if (!client) return false

  const context = {
    environment:
      ctx.environment ??
      (process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local'),
    app: 'fuzefront-security',
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
  }

  try {
    return await client.getBooleanValue(MEMBER_DIRECTORY_FLAG, false, context)
  } catch {
    return false
  }
}
