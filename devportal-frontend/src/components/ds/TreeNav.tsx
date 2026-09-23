/**
 * TreeNav — collapsible hierarchical navigation (product → service).
 *
 * Same status as CodeBlock: manifest.json calls this out as a missing base
 * primitive (navigation/ today only has Breadcrumb + Pagination; shell/MenuItem
 * is a flat item, not a tree). Deferred to a foundation PR per this PR's scope —
 * see PR body. This is the product-local stand-in, tokens-only
 * (`.dp-tree*` in src/styles/devportal.css).
 */
import { useState } from 'react'

export interface TreeNode {
  id: string
  label: string
  children?: TreeNode[]
}

export function TreeNav({
  nodes,
  selectedId,
  onSelect,
  ...rest
}: {
  nodes: TreeNode[]
  selectedId?: string
  onSelect?: (id: string) => void
  [key: string]: unknown
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(nodes.map(n => n.id)))

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div role="tree" className="dp-tree" {...rest}>
      {nodes.map(node => {
        const isExpanded = expanded.has(node.id)
        return (
          <div key={node.id} role="group">
            <button
              type="button"
              role="treeitem"
              className="dp-tree-node"
              data-tree-node={node.id}
              data-expanded={node.children?.length ? String(isExpanded) : undefined}
              aria-selected={selectedId === node.id}
              aria-expanded={node.children?.length ? isExpanded : undefined}
              onClick={() => {
                if (node.children?.length) toggle(node.id)
                onSelect?.(node.id)
              }}
            >
              {node.label}
            </button>
            {node.children?.length && isExpanded && (
              <div className="dp-tree" role="group">
                {node.children.map(child => (
                  <button
                    key={child.id}
                    type="button"
                    role="treeitem"
                    className="dp-tree-node dp-tree-node-child"
                    data-tree-node={child.id}
                    aria-selected={selectedId === child.id}
                    onClick={() => onSelect?.(child.id)}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
