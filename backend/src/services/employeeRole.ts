import type { Knex } from 'knex'
import { db as defaultDb } from '../config/database'
import { userHasRole } from '../utils/permit/role-assignment'
import { ROOT_ORG_ID } from '../migrations/015_seed_root_platform_organization'

/**
 * FF-EPIC-17-S8 — formalizes "Employee" (FuzeFront platform staff) as a
 * named, explicit capability layered on top of the EXISTING ReBAC
 * `org-admin`-on-root derivation (`permit/schema.ts`'s `Organization.roles
 * ['org-admin']`, `rootOrgAdmin.ts`'s `ensureRootOrgAdmins()`,
 * `utils/permit/resource-instances.ts`'s `assignOrgAdminRebac`). This module
 * does NOT reimplement or alter that derivation mechanism — FF-EPIC-05-S4
 * owns the parent→child ReBAC derivation itself — it only:
 *
 *   1. Names the explicit `employee` user-level role marker (`users.roles`)
 *      that formally triggers the SAME root org-admin ReBAC grant the
 *      implicit `roles ~ admin` check has always triggered (see
 *      `rootOrgAdmin.ts`, which keeps the legacy `admin` trigger for
 *      back-compat alongside this new explicit one).
 *   2. Resolves "is this principal an Employee" from the ReBAC grant itself
 *      — never from `organization_memberships` — so authz/UI can reason
 *      about it without inferring from `roles LIKE '%admin%'`.
 *
 * Mirrors `backend/security/src/services/employeeRole.ts` (security is the
 * service that surfaces the "Employee" entry in the role catalog endpoint;
 * this monolith copy is consumed by `rootOrgAdmin.ts`'s grant trigger).
 *
 * SECURITY INVARIANT (FF-EPIC-17-S8 AC2/AC4): an Employee's cross-org
 * authority is 100% DERIVED from the root ReBAC grant. `resolveEmployeeStatus`
 * below NEVER reads `organization_memberships` to decide `isEmployee` — it
 * consults that table ONLY to report (informationally) whether the same user
 * ALSO happens to hold a direct membership somewhere else. There is no code
 * path from a membership row to `isEmployee`, so inserting one can never
 * manufacture Employee status (a bypass attempt is inert by construction,
 * not merely rejected at runtime).
 */

/**
 * The explicit user-level role marker (`users.roles` JSON array) that
 * formally denotes platform staff — distinct from `admin`, which is ALSO a
 * customer-org-assignable role name (`organization_memberships.role`), and
 * is exactly the ambiguity this story resolves: before this, "is this user
 * an Employee" and "is this user a customer org's admin" were both spelled
 * `admin` with no way to tell them apart except by which table you queried.
 */
export const EMPLOYEE_USER_ROLE = 'employee'

/** The ReBAC role key the Employee label sits on top of. Never a new Permit
 * resource/role — see `permit/schema.ts`'s `Organization.roles['org-admin']`. */
export const EMPLOYEE_REBAC_ROLE = 'org-admin'

/**
 * Static platform-role-catalog entry for "Employee" (surfaced by the
 * security service's `GET /:id/roles` → `platformRoles`). Not an
 * org-`assignable` role: Employee can only ever be granted via the root
 * ReBAC assignment (`assignOrgAdminRebac` on `ROOT_ORG_ID`), never via an
 * `organization_memberships` row — see AC4 above.
 */
export const EMPLOYEE_ROLE_CATALOG_ENTRY = {
  key: 'employee',
  name: 'Employee',
  description:
    'FuzeFront platform staff — cross-org authority derived from ReBAC ' +
    'org-admin on the platform root, held with zero per-org membership rows.',
  rebacRole: EMPLOYEE_REBAC_ROLE,
  rebacScope: 'root' as const,
  assignable: false as const,
} as const

function normalizeRoles(
  roles: string[] | string | null | undefined
): string[] {
  if (Array.isArray(roles)) return roles
  if (typeof roles === 'string') {
    try {
      const parsed = JSON.parse(roles)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * True when `roles` formally marks the user as platform staff: the new
 * explicit `employee` marker OR the legacy implicit `admin` marker
 * (back-compat — `ensureRootOrgAdmins` has granted on `admin` since before
 * this story; dropping it would de-provision every existing platform admin's
 * root ReBAC grant on next boot). Excluding the platform-registrar service
 * principal stays the caller's job (`rootOrgAdmin.ts` already excludes it by
 * id) — this is a pure predicate over the roles array alone.
 */
export function isEmployeeByUserRoles(
  roles: string[] | string | null | undefined
): boolean {
  const list = normalizeRoles(roles)
  return list.includes(EMPLOYEE_USER_ROLE) || list.includes('admin')
}

export interface EmployeeStatus {
  userId: string
  /** True iff the user holds the ReBAC `org-admin` grant on the root org —
   * the ONLY source of truth. Never derived from `organization_memberships`. */
  isEmployee: boolean
  roleKey: typeof EMPLOYEE_ROLE_CATALOG_ENTRY.key
  rebacRole: typeof EMPLOYEE_REBAC_ROLE
  /**
   * Customer-org ids (never `ROOT_ORG_ID`) where this user ALSO holds a
   * direct `organization_memberships` row — reported distinctly, never
   * merged into `isEmployee` (FF-EPIC-17-S8 AC3). Empty for a "pure"
   * Employee, consistent with the zero-membership-rows invariant (AC2).
   */
  directOrgMemberships: string[]
}

export interface ResolveEmployeeStatusDeps {
  db: Knex
  /** Defaults to a real ReBAC check (`userHasRole` against Permit).
   * Injectable so callers/tests never need a live Permit connection. */
  hasRootOrgAdminRebac: (userId: string) => Promise<boolean>
}

function getDeps(
  overrides?: Partial<ResolveEmployeeStatusDeps>
): ResolveEmployeeStatusDeps {
  return {
    db: overrides?.db ?? defaultDb,
    hasRootOrgAdminRebac:
      overrides?.hasRootOrgAdminRebac ??
      ((userId: string) => userHasRole(userId, EMPLOYEE_REBAC_ROLE, ROOT_ORG_ID)),
  }
}

/**
 * Resolves whether `userId` is an Employee. See the module doc's SECURITY
 * INVARIANT — `organization_memberships` is consulted ONLY for the
 * informational `directOrgMemberships` field, never to decide `isEmployee`.
 */
export async function resolveEmployeeStatus(
  userId: string,
  overrides?: Partial<ResolveEmployeeStatusDeps>
): Promise<EmployeeStatus> {
  const { db, hasRootOrgAdminRebac } = getDeps(overrides)

  const isEmployee = await hasRootOrgAdminRebac(userId)

  const rows = await db('organization_memberships')
    .where({ user_id: userId })
    .whereNot({ organization_id: ROOT_ORG_ID })
    .select('organization_id')

  return {
    userId,
    isEmployee,
    roleKey: EMPLOYEE_ROLE_CATALOG_ENTRY.key,
    rebacRole: EMPLOYEE_REBAC_ROLE,
    directOrgMemberships: rows.map((r: any) => r.organization_id),
  }
}
