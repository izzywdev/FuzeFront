import type { CSSProperties } from 'react'
import { Avatar } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { DerivedAccessTag } from './DerivedAccessTag'
import type { EmployeeOrgNode } from '../../types'

export interface OrgTreeRowProps {
  org: EmployeeOrgNode
  onSelect: (id: string) => void
}

const cellStyle: CSSProperties = {
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-color)',
  verticalAlign: 'middle',
  textAlign: 'start',
}

/**
 * One row of the cross-org explorer table (01-org-explorer.html `<tr>`,
 * `[data-org]`). A `sub-org` row indents to visually nest under its parent
 * (mirrors the frame's `↳ Sales` treatment) — purely presentational, since
 * the row list itself is already flat (no real tree recursion needed here,
 * unlike `SubOrgTree`, because an Employee's reachable set has no
 * caller-owned nesting to preserve).
 */
export function OrgTreeRow({ org, onSelect }: OrgTreeRowProps) {
  const { messages } = useIdentityI18n()
  const e = messages.employeeConsole
  const nested = org.kind === 'sub-org'

  const kindLabel: Record<EmployeeOrgNode['kind'], string> = {
    root: e.kindRoot,
    portal: e.kindPortal,
    'sub-org': e.kindSubOrg,
    org: e.kindOrg,
  }

  return (
    <tr data-org={org.id}>
      <td style={cellStyle}>
        <button
          type="button"
          onClick={() => onSelect(org.id)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            marginInlineStart: nested ? 'var(--space-6)' : 0,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            font: 'inherit',
            color: 'var(--text-primary)',
          }}
        >
          <Avatar name={org.name} size="sm" />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--weight-medium)' }}>
            {nested ? `↳ ${org.name}` : org.name}
          </span>
        </button>
      </td>
      <td style={cellStyle}>{kindLabel[org.kind]}</td>
      <td style={cellStyle}>{org.memberCount ?? '—'}</td>
      <td style={cellStyle}>
        <DerivedAccessTag variant={org.kind === 'root' ? 'root' : 'default'} />
      </td>
    </tr>
  )
}
