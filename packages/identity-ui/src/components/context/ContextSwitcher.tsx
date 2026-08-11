import type React from 'react'
import { MembershipRoleBadge } from './MembershipRoleBadge'
import { buildOrgForest, type OrgTreeNode } from '../organizations/orgTree'
import type { ContextTarget, OrgContextItem } from '../../types'

export interface ContextSwitcherProps {
  /** The currently active context — 'personal' or an org id. */
  activeTarget: ContextTarget
  /** The caller's display name, shown under the Personal row. */
  userName: string
  /** Every org the caller directly belongs to (root included). */
  organizations: OrgContextItem[]
  rootOrgId?: string
  onSelect: (target: ContextTarget) => void
  onCreateOrg: () => void
  /** Hide the "Create organization" footer (e.g. no Organization:create permission). */
  canCreate?: boolean
}

const rowBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-4)',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  border: 'none',
  background: 'none',
  width: '100%',
  textAlign: 'start',
  fontSize: 'var(--text-md)',
  fontFamily: 'var(--font-sans)',
}

function SwitcherAvatar({ label, personal }: { label: string; personal?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: '26px',
        height: '26px',
        flex: 'none',
        borderRadius: 'var(--radius-sm)',
        display: 'grid',
        placeItems: 'center',
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--weight-semibold)',
        color: personal ? 'var(--accent-2)' : 'var(--bg-primary)',
        background: personal ? 'var(--bg-primary)' : 'var(--seam)',
        border: personal ? '1px solid var(--accent-2)' : 'none',
      }}
    >
      {label}
    </span>
  )
}

function SwitcherRow({
  node,
  depth,
  active,
  onSelect,
}: {
  node: OrgTreeNode
  depth: number
  active: ContextTarget
  onSelect: (target: ContextTarget) => void
}) {
  const { item } = node
  const isActive = active === item.id
  return (
    <>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={isActive}
        data-switch-target={item.id}
        data-role={item.role ?? 'guest'}
        onClick={() => onSelect(item.id)}
        style={{
          ...rowBase,
          paddingInlineStart: depth > 0 ? 'var(--space-8)' : 'var(--space-4)',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          background: isActive ? 'var(--accent-soft)' : 'transparent',
        }}
      >
        <SwitcherAvatar label={item.name[0]?.toUpperCase() ?? '?'} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block' }}>
            {depth > 0 ? '↳ ' : ''}
            {item.name}
          </span>
          <span
            style={{
              display: 'block',
              fontSize: 'var(--text-2xs)',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {item.isRoot ? 'root' : item.isPortal ? 'portal' : depth > 0 ? 'sub-org' : 'member org'}
            {' · '}
            {item.role ?? 'guest'}
          </span>
        </span>
        <MembershipRoleBadge role={item.role} />
        {isActive && (
          <span aria-hidden="true" style={{ color: 'var(--success-color)' }}>
            ✓
          </span>
        )}
      </button>
      {node.children.map(child => (
        <SwitcherRow key={child.item.id} node={child} depth={depth + 1} active={active} onSelect={onSelect} />
      ))}
    </>
  )
}

const sectionLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-2xs)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  color: 'var(--text-tertiary)',
  padding: 'var(--space-3) var(--space-4) var(--space-1)',
}

/**
 * The unified context switcher menu — 03-switcher.html. Reconciles the local
 * `<select>` in OrganizationPage.tsx and the canonical persisted
 * `setActiveOrganization` in UserMenu.tsx into ONE menu: Personal is a
 * first-class `menuitemradio`, never an org row; org rows nest their direct
 * sub-orgs; the active row carries `aria-checked="true"` + a check glyph.
 */
export function ContextSwitcher({
  activeTarget,
  userName,
  organizations,
  rootOrgId,
  onSelect,
  onCreateOrg,
  canCreate = true,
}: ContextSwitcherProps) {
  const forest = buildOrgForest(organizations, rootOrgId)
  const personalActive = activeTarget === 'personal'

  return (
    <div
      role="menu"
      data-panel="context-switcher"
      aria-label="Switch context"
      style={{
        maxWidth: '340px',
        minWidth: '280px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        overflow: 'hidden',
      }}
    >
      <div style={sectionLabelStyle}>Personal</div>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={personalActive}
        data-switch-target="personal"
        onClick={() => onSelect('personal')}
        style={{
          ...rowBase,
          color: personalActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          background: personalActive ? 'var(--accent-soft)' : 'transparent',
        }}
      >
        <SwitcherAvatar label="◎" personal />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block' }}>{userName}</span>
          <span
            style={{
              display: 'block',
              fontSize: 'var(--text-2xs)',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            operate as yourself
          </span>
        </span>
        {personalActive && (
          <span aria-hidden="true" style={{ color: 'var(--success-color)' }}>
            ✓
          </span>
        )}
      </button>

      {forest.length > 0 && (
        <>
          <div style={sectionLabelStyle}>Organizations</div>
          {forest.map(node => (
            <SwitcherRow key={node.item.id} node={node} depth={0} active={activeTarget} onSelect={onSelect} />
          ))}
        </>
      )}

      {canCreate && (
        <div style={{ borderTop: '1px solid var(--border-color)' }}>
          <button
            type="button"
            data-action="create-org"
            onClick={onCreateOrg}
            style={rowBase}
          >
            <span
              aria-hidden="true"
              style={{
                width: '26px',
                height: '26px',
                flex: 'none',
                borderRadius: 'var(--radius-sm)',
                display: 'grid',
                placeItems: 'center',
                background: 'var(--bg-quaternary)',
                color: 'var(--accent-color)',
              }}
            >
              ＋
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block' }}>Create organization</span>
              <span
                style={{
                  display: 'block',
                  fontSize: 'var(--text-2xs)',
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                a new opt-in tenant you own
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
