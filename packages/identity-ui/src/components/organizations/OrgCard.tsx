import { Badge, Button } from '@fuzefront/design-system'
import { MembershipRoleBadge } from '../context/MembershipRoleBadge'
import { SubOrgTree } from './SubOrgTree'
import type { OrgTreeNode } from './orgTree'

export interface OrgCardProps {
  node: OrgTreeNode
  onOpen: (id: string) => void
}

/**
 * One row in "My orgs & sub-orgs" — 04-my-orgs.html's `.org-card`. Shows the
 * `root`/`portal` type badge (when applicable), the caller's real role, and
 * its direct sub-org tree via `SubOrgTree`.
 */
export function OrgCard({ node, onOpen }: OrgCardProps) {
  const { item } = node
  return (
    <div
      data-org={item.id}
      data-role={item.role ?? 'guest'}
      style={{
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4) var(--space-5)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <span
          aria-hidden="true"
          style={{
            width: '34px',
            height: '34px',
            flex: 'none',
            borderRadius: 'var(--radius-sm)',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--bg-primary)',
            background: 'var(--seam)',
          }}
        >
          {item.name[0]?.toUpperCase() ?? '?'}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)' }}>
            {item.name}{' '}
            {item.isRoot && <Badge tone="accent">root</Badge>}
            {item.isPortal && <Badge tone="accent">portal</Badge>}
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            {item.isRoot
              ? 'The platform tenant — everyone is a member'
              : node.children.length > 0
                ? `${node.children.length} sub-org${node.children.length === 1 ? '' : 's'}`
                : undefined}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <MembershipRoleBadge role={item.role} />
        <Button variant="ghost" onClick={() => onOpen(item.id)}>
          Open
        </Button>
      </div>
      <SubOrgTree nodes={node.children} />
    </div>
  )
}
