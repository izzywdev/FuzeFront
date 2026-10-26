import type { Organization } from '../services/api'

/**
 * True when the caller actually BELONGS to `o`, as opposed to merely seeing it.
 *
 * `GET /api/organizations` returns every org the caller is a member of PLUS
 * every `type='platform'` org (backend/security/src/routes/organizations.ts),
 * projecting the caller's own role as `user_role` — `null` for a platform org
 * they only have visibility into. A response that omits the field falls back
 * to excluding platform orgs, which is equivalent: a non-platform org is only
 * ever returned because a membership row exists.
 */
export function isProvisionedMembership(o: Organization): boolean {
  if (o.user_role !== undefined) {
    return o.user_role != null
  }
  return o.type !== 'platform'
}

/**
 * True when `o` is the caller's personal workspace, by EITHER signal:
 *
 *   - `type === 'personal'` — the classification `ensurePersonalOrg` writes; OR
 *   - `metadata.personal === true` — the durable marker it ALSO stamps, which
 *     is the one that survives a mis-typing.
 *
 * The second clause is load-bearing, not redundant: migration 022 reclassified
 * personal orgs `type='personal' -> 'organization'` unconditionally, including
 * on production where the root-membership backfill had to skip (#750), so a
 * personal org can carry `type='organization'` while still being, in fact, a
 * personal workspace. `metadata.personal` is intact on those rows — 022 only
 * touched `type` — and `025_repair_personal_org_over_reclassification` keys the
 * data-side restore on exactly this marker ("nothing else writes that metadata
 * shape"). Until that repair reaches a given database, the switcher must not
 * trust `type` alone, or the over-reclassified personal org reappears beside
 * the first-class Personal context as a second "Personal [OWNER]" row — the
 * duplicate this function exists to prevent. Prefix-safe: reads `metadata`, not
 * an id, so `fuzefront.identity.prefixed-ids` does not affect it.
 */
export function isPersonalWorkspaceOrg(o: Organization): boolean {
  return o.type === 'personal' || o.metadata?.personal === true
}

/**
 * Orgs the reconciled context switcher (`fuzefront.identity.personal-context`)
 * offers as targets: real memberships only, never a personal-workspace row.
 *
 * design/frames/identity-context-switcher/index.html: "`type='personal'` orgs
 * are dropped from the switcher — a person is Personal, not the owner of a
 * personal org." Personal is the first-class `null` context; listing the
 * legacy personal org beside it showed "Personal" twice (see
 * isPersonalWorkspaceOrg for why `type` alone is not enough). Visibility-only
 * platform orgs (role `null`, rendered as GUEST) are not switch targets
 * either — production carries two platform orgs (migration 025a), and every
 * user saw the legacy one as a GUEST row they could do nothing in.
 */
export function isSwitcherContextOrg(o: Organization): boolean {
  return !isPersonalWorkspaceOrg(o) && isProvisionedMembership(o)
}
