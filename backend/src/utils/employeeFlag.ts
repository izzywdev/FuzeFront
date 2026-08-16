/**
 * FF-EPIC-17-S8 — the `fuzefront.identity.employee-console` flag: gates the
 * "Employee" formalization behavior introduced by this story —
 *   1. widening `rootOrgAdmin.ts`'s root org-admin grant trigger to also
 *      recognize the new EXPLICIT `employee` user-role marker (in addition
 *      to the legacy implicit `roles ~ admin` trigger, which is unaffected
 *      and always active), and
 *   2. surfacing the "Employee" entry in the role catalog
 *      (`GET /api/organizations/:id/roles` → `platformRoles`, security
 *      service).
 *
 * Named for, and shared with, FF-EPIC-17-S9 (the Employee cross-org console)
 * per the epic's flag taxonomy (`docs/planning/epics/
 * EPIC-17-personal-identity-portal-employee-reconciliation.md`) — S8 formalizes
 * the role/label this flag also gates the console for; they are not split
 * into two flags because S9 has no meaning without S8's label already existing.
 *
 * Type: release. Owner: backend-engineer (identity). Default: OFF (Unleash
 * admin default — the new explicit-marker grant trigger and the role-catalog
 * label are dark until deliberately rolled out; OFF preserves today's
 * implicit-admin-only behavior with zero regression). Removal criterion:
 * delete this flag once the Employee label + explicit-marker trigger are
 * 100% rolled out and the flag-OFF path is no longer exercised in prod.
 *
 * NOTE: this flag is rollout convenience only. It never replaces a
 * `permit.check` / the ReBAC `org-admin`-on-root grant itself — real authz
 * for Employees stays entirely in Permit; this flag only controls whether the
 * EXPLICIT `employee` marker is (a) honored as an additional grant trigger and
 * (b) labeled in the catalog. The legacy implicit `admin`-role trigger keeps
 * working identically regardless of this flag's state.
 *
 * Read via @fuzefront/feature-flags (OpenFeature) per the `feature-flags`
 * skill — never a hand-wired Unleash/OpenFeature call. Loaded lazily (mirrors
 * utils/rootMembershipFlag.ts / utils/portalFlag.ts / utils/identityFlag.ts)
 * so a missing/unbuilt package degrades to the fail-safe default (OFF) rather
 * than crashing route/service modules at import time.
 */

export const EMPLOYEE_CONSOLE_FLAG = 'fuzefront.identity.employee-console'

export interface EmployeeFlagContext {
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
 * Evaluates the employee-console flag for the current request/operation.
 * NEVER throws — any failure (package absent, provider unreachable,
 * evaluation error) degrades to the release-flag fail-safe default: OFF
 * (today's implicit-admin-only behavior, unchanged).
 */
export async function isEmployeeConsoleEnabled(
  ctx: EmployeeFlagContext = {}
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
    return await client.getBooleanValue(EMPLOYEE_CONSOLE_FLAG, false, context)
  } catch {
    return false
  }
}
