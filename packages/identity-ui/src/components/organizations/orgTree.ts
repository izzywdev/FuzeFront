import type { OrgContextItem } from '../../types'

export interface OrgTreeNode {
  item: OrgContextItem
  children: OrgTreeNode[]
}

/**
 * Builds the forest the switcher/my-orgs frames render: top-level rows plus
 * recursive sub-org nesting — but ONLY among the caller's direct memberships.
 *
 * The platform root is always top-level (never nested under itself, and
 * never treated as the "parent" other rows nest under) — matching
 * 03-switcher.html / 04-my-orgs.html, where the root org, Northwind (a
 * portal, parent = root) and Acme Co all sit as SIBLINGS, while Sales nests
 * under Northwind because the user's own membership chain is Northwind →
 * Sales. Access held only through the parent/root (no direct row) never
 * appears here — "direct memberships only" (04-my-orgs.html acceptanceNotes).
 */
export function buildOrgForest(items: OrgContextItem[], rootOrgId?: string): OrgTreeNode[] {
  const byId = new Map(items.map(i => [i.id, i]))

  function effectiveParentId(item: OrgContextItem): string | null {
    if (item.isRoot) return null
    if (!item.parentId) return null
    if (item.parentId === rootOrgId) return null
    // Only nest under a parent the caller also has a direct row for.
    return byId.has(item.parentId) ? item.parentId : null
  }

  const nodeById = new Map<string, OrgTreeNode>()
  for (const item of items) nodeById.set(item.id, { item, children: [] })

  const roots: OrgTreeNode[] = []
  for (const item of items) {
    const node = nodeById.get(item.id)!
    const parentId = effectiveParentId(item)
    if (parentId && nodeById.has(parentId)) {
      nodeById.get(parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // Root org first (if present), then everything else in original order.
  roots.sort((a, b) => (b.item.isRoot ? 1 : 0) - (a.item.isRoot ? 1 : 0))
  return roots
}

/** Flattens the forest back to a list, depth-first — handy for tests/counts. */
export function flattenForest(nodes: OrgTreeNode[]): OrgContextItem[] {
  const out: OrgContextItem[] = []
  for (const node of nodes) {
    out.push(node.item)
    out.push(...flattenForest(node.children))
  }
  return out
}
