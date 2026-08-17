/**
 * FF-EPIC-17-S9 — client-side "is this caller an Employee" gate for the
 * cross-org staff console (`@fuzefront/identity-ui`'s `EmployeeConsoleFlow`).
 *
 * Mirrors the SAME predicate `backend/src/services/employeeRole.ts`'s
 * `isEmployeeByUserRoles()` (FF-EPIC-17-S8) applies server-side: the explicit
 * `employee` user-role marker, OR the legacy implicit `admin` marker
 * (back-compat — `rootOrgAdmin.ts` has granted the root ReBAC `org-admin`
 * trigger on `admin` since before S8).
 *
 * CONTRACT GAP (flagged in the FF-EPIC-17-S9 PR): there is no backend route
 * wired to `resolveEmployeeStatus()` yet — `GET /api/organizations/:id/roles`
 * only surfaces the "Employee" catalog ENTRY (`platformRoles`), never
 * "is-this-caller-one". Until a dedicated server-authoritative
 * employee-status endpoint exists, this reads the already-authenticated
 * session's `roles` (from `useCurrentUser()`, itself sourced from the signed
 * session/JWT — not client-forgeable in a way that widens what data the
 * caller actually receives). This is a UI-ONLY convenience gate: it decides
 * whether the console's read-only screens render, never an authorization
 * decision — every route the console calls stays independently enforced
 * server-side via Permit. Real fail-closed enforcement does not, and must
 * never, depend on this function.
 */
export function isEmployeeUser(roles: string[] | null | undefined): boolean {
  if (!roles) return false
  return roles.includes('employee') || roles.includes('admin')
}
