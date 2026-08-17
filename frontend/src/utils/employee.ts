/**
 * FF-EPIC-17-S9 — client-side "is this caller an Employee" FIRST-PAINT HINT
 * for the cross-org staff console (`@fuzefront/identity-ui`'s
 * `EmployeeConsoleFlow`). NOT the authoritative gate.
 *
 * Mirrors the SAME predicate `backend/src/services/employeeRole.ts`'s
 * `isEmployeeByUserRoles()` (FF-EPIC-17-S8) applies server-side: the explicit
 * `employee` user-role marker, OR the legacy implicit `admin` marker
 * (back-compat — `rootOrgAdmin.ts` has granted the root ReBAC `org-admin`
 * trigger on `admin` since before S8).
 *
 * As of PR #698 / `@fuzefront/security-client` 0.6.0, the AUTHORITATIVE gate
 * is `GET /v1/security/employee/status` (`resolveEmployeeStatus`, via
 * `createEmployeeClient().getStatus()` in `EmployeeConsolePage.tsx`) — this
 * function is kept ONLY as an optimistic first-paint value so a likely
 * Employee doesn't see the fail-closed notice flash while the server call is
 * in flight; the server response always wins once it resolves, in both
 * directions (it can flip an optimistic `true` back to `false`, never the
 * reverse). Every route the console calls also stays independently enforced
 * server-side via Permit — this predicate is UI-ONLY and never widens what
 * data the caller actually receives.
 */
export function isEmployeeUser(roles: string[] | null | undefined): boolean {
  if (!roles) return false
  return roles.includes('employee') || roles.includes('admin')
}
