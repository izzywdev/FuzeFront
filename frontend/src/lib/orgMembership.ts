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
  // Two branches, in priority order:
  //   1. `user_role` present (including an explicit `null`): it is authoritative
  //      — `null` means "visible but not a member" → false; any role → true.
  //      This branch is taken whenever the key exists, because `null !==
  //      undefined`, so `type` is NOT consulted when `user_role` is present.
  //   2. `user_role` absent (`=== undefined`): fall back to excluding only
  //      `type='platform'` orgs (a non-platform org is only ever returned
  //      because a membership row exists).
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

/** True when the list contains a genuine `type='personal'` org. */
export function hasGenuinePersonalOrg(orgs: readonly Organization[]): boolean {
  return orgs.some(o => o.type === 'personal')
}

/**
 * Whether `o` should be treated as THE caller's Personal context: hidden from
 * the switcher and resolved to the `null` ("operate as yourself") context,
 * because the first-class Personal row already represents it.
 *
 * A genuine `type='personal'` org always is. An over-reclassified org
 * (`metadata.personal === true` but `type !== 'personal'`, from migration 022 —
 * see isPersonalWorkspaceOrg) is too, but ONLY when BOTH hold:
 *
 *  - the caller OWNS it (`user_role === 'owner'`). Org lists are membership-
 *    scoped, not owner-scoped, so a marked org the caller merely belongs to is
 *    someone else's workspace — a DISTINCT tenant that must stay selectable, not
 *    be swallowed into the caller's own Personal context. (Prefix-safe: compares
 *    a role string, never an id.)
 *  - no genuine `type='personal'` org exists in the list. That is the
 *    migration-025 collision case (025 skips restoring the over-reclassified row
 *    when a genuine personal org already holds content): there
 *    `securitySessionAPI.resolvePersonalTenant()` resolves the genuine one as the
 *    `null` context, so the over-reclassified one is a distinct tenant whose data
 *    would be stranded if hidden too.
 *
 * Both edges reduce to the same principle the reviewer named: hide a marked org
 * only when it is the actual tenant that Personal represents, never because no
 * correctly-typed workspace happens to exist. List-aware by necessity — a
 * collision is only visible across the whole list.
 */
export function isPersonalContextOrg(o: Organization, orgs: readonly Organization[]): boolean {
  if (o.type === 'personal') return true
  if (o.metadata?.personal !== true) return false
  // Over-reclassified: the Personal context only when the caller OWNS it and it
  // is the sole personal representation (no genuine type='personal' sibling).
  return o.user_role === 'owner' && !hasGenuinePersonalOrg(orgs)
}

/**
 * Orgs the reconciled context switcher (`fuzefront.identity.personal-context`)
 * offers as targets: real memberships only, never the Personal-context row.
 *
 * design/frames/identity-context-switcher/index.html: "`type='personal'` orgs
 * are dropped from the switcher — a person is Personal, not the owner of a
 * personal org." Personal is the first-class `null` context; listing the
 * legacy personal org beside it showed "Personal" twice (see isPersonalContextOrg
 * for which orgs count, and why a distinct collision-case tenant does NOT).
 * Visibility-only platform orgs (role `null`, rendered as GUEST) are not switch
 * targets either — production carries two platform orgs (migration 025a), and
 * every user saw the legacy one as a GUEST row they could do nothing in.
 */
export function isSwitcherContextOrg(o: Organization, orgs: readonly Organization[]): boolean {
  return !isPersonalContextOrg(o, orgs) && isProvisionedMembership(o)
}
