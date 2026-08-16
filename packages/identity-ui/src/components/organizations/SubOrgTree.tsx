import { flattenForest, type OrgTreeNode } from './orgTree'
import { MembershipRoleBadge } from '../context/MembershipRoleBadge'

export interface SubOrgTreeProps {
  nodes: OrgTreeNode[]
}

/**
 * The nested sub-org rows under an `OrgCard` — 04-my-orgs.html's
 * `data-list="sub-orgs"` block (Northwind → Sales / Operations). Renders the
 * caller's direct sub-org memberships only.
 */
export function SubOrgTree({ nodes }: SubOrgTreeProps) {
  if (nodes.length === 0) return null
  const rows = flattenForest(nodes)

  return (
    <div
      data-list="sub-orgs"
      style={{
        marginBlockStart: 'var(--space-3)',
        paddingBlockStart: 'var(--space-3)',
        borderBlockStart: '1px dashed var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      {rows.map((item, i) => (
        <div
          key={item.id}
          data-org={item.id}
          data-role={item.role ?? 'guest'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            paddingInlineStart: 'var(--space-4)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
          }}
        >
          <span aria-hidden="true" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {i === rows.length - 1 ? '└─' : '├─'}
          </span>
          <span>{item.name}</span>
          <span style={{ flex: 1 }} />
          <MembershipRoleBadge role={item.role} />
        </div>
      ))}
    </div>
  )
}
