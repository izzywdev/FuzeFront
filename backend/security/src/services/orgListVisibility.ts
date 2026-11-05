import type { Knex } from 'knex'
import { db as defaultDb } from '../config/database'
import { ROOT_ORG_ID } from '../migrations/014_seed_root_platform_organization'
import { isEmployeeByUserRoles } from './employeeRole'

/**
 * Owner-decided visibility rule for the organizations list a user sees
 * (`GET /api/organizations`, the call behind the shell's org switcher and
 * "My organizations"):
 *
 *   SHOW only orgs where the caller holds a DIRECT, ACTIVE
 *   `organization_memberships` row (a tenant they actually operate in).
 *
 *   HIDE
 *     - the FuzeFront ROOT org. Root-membership made every user a `member`
 *       of root, so a plain "has a membership row" test would show it to
 *       everybody. Platform staff (employees / platform admins) still see it.
 *     - every ancestor the caller is NOT a direct member of. Visibility is
 *       decided per org row from the caller's own membership; `parent_id` is
 *       never walked, so no transitive/structural membership can surface an
 *       org in this list.
 *
 * How the three are told apart (data model):
 *   direct   = an `organization_memberships` row with user_id = caller and
 *              status = 'active' for that exact organization_id.
 *   root     = organizations.id = ROOT_ORG_ID, or type = 'platform' (the
 *              reserved operator-only marker that only a migration can mint;
 *              covers a prod DB whose adopted root carries a different id —
 *              see migration 015).
 *   ancestor = any org reachable by following parent_id upward from a direct
 *              org. It is not a distinct column: it is simply an org with no
 *              direct row for the caller, which the direct-membership test
 *              already excludes.
 *   staff    = platform staff: the explicit `employee` / legacy `admin`
 *              user-level role marker (the same predicate the shell uses and
 *              the one that triggers the root ReBAC org-admin grant), OR an
 *              active owner/admin membership on the root org itself.
 *
 * This only narrows what the LIST returns. It is not an authorization
 * boundary: the employee console (`/v1/security/employee/*`) keeps its own
 * ReBAC-derived gate and is untouched, and every org-scoped route keeps its own
 * check. An id is never a capability.
 *
 * FAIL SAFE: if staff status cannot be resolved the caller is treated as NOT
 * staff, i.e. the root org stays hidden — an unresolvable lookup must never
 * widen what is listed.
 */

export interface OrgListViewer {
  userId: string
  roles?: string[] | string | null
}

/** Root owner/admin membership roles that mark a platform administrator. */
const ROOT_ADMIN_MEMBERSHIP_ROLES = ['owner', 'admin']

/**
 * Whether the caller may see the root org in their list. Never throws.
 */
export async function viewerSeesRootOrg(
  viewer: OrgListViewer,
  database: Knex = defaultDb
): Promise<boolean> {
  if (isEmployeeByUserRoles(viewer.roles)) return true
  try {
    const row = await database('organization_memberships')
      .where('user_id', viewer.userId)
      .where('organization_id', ROOT_ORG_ID)
      .where('status', 'active')
      .whereIn('role', ROOT_ADMIN_MEMBERSHIP_ROLES)
      .first()
    return !!row
  } catch {
    return false
  }
}

/**
 * Narrows `query` (over `organizations`) to the orgs the viewer may see.
 *
 * `seesRoot = false`  -> direct active memberships only, root org excluded.
 * `seesRoot = true`   -> direct active memberships plus the root org by id
 *                        (the pre-existing behavior; also what the kill-switch
 *                        OFF path uses).
 */
export function applyOrgListVisibility<T extends Knex.QueryBuilder>(
  query: T,
  opts: { userId: string; seesRoot: boolean },
  database: Knex = defaultDb
): T {
  query.where(function (this: Knex.QueryBuilder) {
    this.whereExists(function (this: Knex.QueryBuilder) {
      this.select(database.raw('1'))
        .from('organization_memberships as om2')
        .whereRaw('om2.organization_id = organizations.id')
        .andWhere('om2.user_id', opts.userId)
        .andWhere('om2.status', 'active')
    })
    if (opts.seesRoot) {
      this.orWhere('organizations.id', ROOT_ORG_ID)
    }
  })

  if (!opts.seesRoot) {
    // Belt and braces: even though a (baseline) root membership row exists for
    // everyone, the root never lists for a non-staff caller.
    query
      .where('organizations.id', '<>', ROOT_ORG_ID)
      .whereRaw("organizations.type::text IS DISTINCT FROM 'platform'")
  }
  return query
}
