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
 * Orgs the reconciled context switcher (`fuzefront.identity.personal-context`)
 * offers as targets: real memberships only, never a `type='personal'` row.
 *
 * design/frames/identity-context-switcher/index.html: "`type='personal'` orgs
 * are dropped from the switcher — a person is Personal, not the owner of a
 * personal org." Personal is the first-class `null` context; listing the
 * legacy personal org beside it showed "Personal" twice. Visibility-only
 * platform orgs (role `null`, rendered as GUEST) are not switch targets
 * either — production carries two platform orgs (migration 025a), and every
 * user saw the legacy one as a GUEST row they could do nothing in.
 */
export function isSwitcherContextOrg(o: Organization): boolean {
  return o.type !== 'personal' && isProvisionedMembership(o)
}
