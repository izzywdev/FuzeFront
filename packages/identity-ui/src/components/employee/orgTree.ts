import type { EmployeeOrgKind, EmployeeOrgNode } from '../../types'
import type { EmployeeOrgListItem } from '../../api/employeeClient'

/**
 * Maps the server-authoritative `EmployeeOrgNode` DTO's `kind`
 * (`root` | `portal` | `organization`) + `depth` (distance from the
 * platform root) onto the UI's four-way `EmployeeOrgKind`
 * (`root` | `portal` | `sub-org` | `org`) that `OrgTreeRow`/`kindLabel`
 * render. The server only distinguishes a portal from a plain organization
 * — `sub-org` vs `org` is purely presentational indentation (`OrgTreeRow`
 * nests a `sub-org` row under its parent), derived from `depth`: an
 * `organization` at depth 1 sits directly under root (a top-level customer
 * org, `org`); deeper than that is nested under some OTHER non-root org
 * (`sub-org`). Unlike `classifyOrgKind` (the pre-S9 heuristic that treated
 * "any direct child of root" as a portal), `root`/`portal` here come
 * straight from the ReBAC-authoritative server field, never re-derived.
 */
export function mapEmployeeOrgKind(kind: EmployeeOrgListItem['kind'], depth: number): EmployeeOrgKind {
  if (kind === 'root') return 'root'
  if (kind === 'portal') return 'portal'
  return depth > 1 ? 'sub-org' : 'org'
}

/**
 * Assembles the flat, cursor-paginated `EmployeeOrgNode` items the
 * `GET /v1/security/employee/orgs` page-walk accumulates into the pre-order
 * tree `CrossOrgExplorer`/`OrgTreeRow` render. The wire shape is
 * deliberately flat (openapi.yaml: "an explicit nested tree ... cannot be
 * paginated ... a page boundary would split a subtree") — this is the
 * client-side reassembly the contract puts on the caller, using each item's
 * `parentOrgId`, so a `sub-org` row renders directly under its parent,
 * matching the frame's nesting (`design/frames/employee-console/01-org-explorer.html`).
 *
 * Siblings are sorted by name for a stable, deterministic render order (the
 * wire order across pages is not itself meaningful). Any item whose parent
 * is missing from the accumulated set (should not happen for a full
 * root-to-`hasMore:false` walk, since the reachable set is closed under
 * `parent`) is appended at the end rather than silently dropped.
 */
export function assembleEmployeeOrgTree(items: EmployeeOrgListItem[]): EmployeeOrgNode[] {
  const byParent = new Map<string | null, EmployeeOrgListItem[]>()
  for (const item of items) {
    const key = item.parentOrgId ?? null
    const siblings = byParent.get(key)
    if (siblings) siblings.push(item)
    else byParent.set(key, [item])
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name))
  }

  const out: EmployeeOrgNode[] = []
  const visited = new Set<string>()

  const visit = (item: EmployeeOrgListItem) => {
    if (visited.has(item.orgId)) return
    visited.add(item.orgId)
    out.push({
      id: item.orgId,
      name: item.name,
      kind: mapEmployeeOrgKind(item.kind, item.depth),
      parentId: item.parentOrgId,
      memberCount: item.memberCount,
    })
    for (const child of byParent.get(item.orgId) ?? []) visit(child)
  }

  const roots = byParent.get(null) ?? []
  for (const root of roots) visit(root)

  // Defensive: an item whose declared parent never appeared in this page
  // walk (should not happen for a closed reachable set) still renders,
  // rather than being silently dropped from the explorer.
  for (const item of items) visit(item)

  return out
}
