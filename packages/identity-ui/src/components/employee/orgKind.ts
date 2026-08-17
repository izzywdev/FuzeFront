import type { EmployeeOrgKind } from '../../types'

/**
 * Classifies a reachable org's position relative to the platform root, for
 * the cross-org explorer row (design/frames/employee-console/01-org-explorer.html
 * — columns render `root` / `portal` / `sub-org` / `org`).
 *
 * There is no backend-modeled "portal" distinction on `organizations` today
 * (`type` is only `'platform' | 'organization' | 'personal'`, and `'platform'`
 * is reserved for the single seeded root row) — this is a presentational
 * heuristic derived purely from tree shape:
 *   - `root`     — the pinned platform root org itself.
 *   - `portal`   — a direct child of root (mirrors `OrgContextItem.isPortal`
 *                  from FF-EPIC-17-S4's `MyOrganizationsPage.tsx`).
 *   - `sub-org`  — nested under some OTHER (non-root) org.
 *   - `org`      — a standalone top-level customer org (no parent on record).
 *
 * Flagged in the FF-EPIC-17-S9 PR report as a candidate for a real modeled
 * distinction once a dedicated cross-org listing endpoint exists.
 */
export function classifyOrgKind(
  org: { id: string; parentId?: string | null },
  rootOrgId?: string
): EmployeeOrgKind {
  if (rootOrgId && org.id === rootOrgId) return 'root'
  if (!org.parentId) return 'org'
  if (rootOrgId && org.parentId === rootOrgId) return 'portal'
  return 'sub-org'
}
