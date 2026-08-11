/**
 * FF-EPIC-17-S1/S2 — the `fuzefront.identity.root-membership` flag: gates the
 * provisioning behavior CHANGE from "create a `type='personal'` org per user"
 * to "upsert a literal `member` row in the root FuzeFront org, no personal
 * org created". See `docs/planning/epics/EPIC-17-personal-identity-portal-
 * employee-reconciliation.md` (S1/S2) and the plan of record at
 * `/root/.claude/plans/as-you-can-see-glimmering-rabbit.md`.
 *
 * Type: release. Owner: backend-engineer (identity). Default: OFF (Unleash
 * admin default, per the `feature-flags` skill — the new provisioning path is
 * dark until deliberately rolled out; OFF preserves today's personal-org
 * behavior with zero regression). Removal criterion: delete this flag + the
 * `ensurePersonalOrg`/personal-org-creation OFF-path in
 * `organizationProvisioning.ts` once root membership is 100% rolled out and
 * the flag-OFF path is no longer exercised in prod.
 *
 * NOTE: this flag is rollout convenience only. It does not replace a
 * `permit.check` — `assignOrganizationRole` (Permit tenant role sync) runs on
 * BOTH the ON and OFF paths; real authorization is unaffected by this flag's
 * state.
 *
 * Read via @fuzefront/feature-flags (OpenFeature) per the `feature-flags`
 * skill — never a hand-wired Unleash/OpenFeature call. Loaded lazily (mirrors
 * backend/src/utils/portalFlag.ts and identityFlag.ts) so a missing/unbuilt
 * package degrades to the fail-safe default (OFF) rather than crashing
 * route/service modules at import time.
 */

export const ROOT_MEMBERSHIP_FLAG = 'fuzefront.identity.root-membership'

export interface RootMembershipFlagContext {
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
 * Evaluates the root-membership flag for the current request/operation.
 * NEVER throws — any failure (package absent, provider unreachable,
 * evaluation error) degrades to the release-flag fail-safe default: OFF
 * (today's personal-org provisioning behavior, unchanged).
 */
export async function isRootMembershipEnabled(
  ctx: RootMembershipFlagContext = {}
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
    return await client.getBooleanValue(ROOT_MEMBERSHIP_FLAG, false, context)
  } catch {
    return false
  }
}
