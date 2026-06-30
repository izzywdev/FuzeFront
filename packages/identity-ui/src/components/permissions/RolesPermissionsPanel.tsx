import React, { useMemo } from 'react'
import { RoleBadge, Badge } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { EmptyState } from '../common/EmptyState'
import type { RolesCatalog } from '../../types'

export interface RolesPermissionsPanelProps {
  catalog: RolesCatalog | null
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

/** One flattened permission row: `"<ResourceKey>:<action>"` with display labels. */
interface PermissionRow {
  key: string
  resourceName: string
  actionName: string
}

const KNOWN_ROLES = new Set(['owner', 'admin', 'member', 'viewer'])

/** RoleBadge for the four built-in org roles; a mono Badge for product roles. */
function RoleLabel({ roleKey, name }: { roleKey: string; name: string }) {
  if (KNOWN_ROLES.has(roleKey)) {
    return <RoleBadge role={roleKey as 'owner' | 'admin' | 'member' | 'viewer'} />
  }
  return <Badge mono size="sm">{name}</Badge>
}

const cellStyle: React.CSSProperties = {
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-color)',
  verticalAlign: 'middle',
  textAlign: 'start',
}

const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-medium)',
  color: 'var(--text-secondary)',
  textAlign: 'center',
}

/**
 * Read-only role × permission matrix. Lists every assignable organization role
 * and the permissions each grants, using the resource/action catalog for
 * human-readable labels. Rendered as a semantic, accessible table.
 */
export function RolesPermissionsPanel({ catalog, loading, error, onRetry }: RolesPermissionsPanelProps) {
  const { messages, t } = useIdentityI18n()
  const p = messages.permissions

  // Flatten resources → permission rows, preserving catalog order.
  const rows = useMemo<PermissionRow[]>(() => {
    if (!catalog) return []
    return catalog.resources.flatMap((resource) =>
      resource.actions.map((action) => ({
        key: `${resource.key}:${action.key}`,
        resourceName: resource.name,
        actionName: action.name,
      }))
    )
  }, [catalog])

  const grantedSets = useMemo(() => {
    const map = new Map<string, Set<string>>()
    catalog?.roles.forEach((role) => map.set(role.key, new Set(role.permissions)))
    return map
  }, [catalog])

  if (error) {
    return <EmptyState variant="error" title={p.errorTitle} message={error} actionLabel={messages.common.retry} onAction={onRetry} />
  }

  if (loading && !catalog) {
    return (
      <div role="status" aria-live="polite" style={{ padding: 'var(--space-6)', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
        {messages.common.loading}
      </div>
    )
  }

  if (!catalog || catalog.roles.length === 0 || rows.length === 0) {
    return <EmptyState variant="empty-permissions" title={p.emptyTitle} message={p.emptyBody} />
  }

  return (
    <section aria-labelledby="perm-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <h2 id="perm-heading" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)', margin: 0 }}>
          {p.title}
        </h2>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 'var(--space-1) 0 0' }}>
          {p.intro}
        </p>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <caption style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            {p.title} — {p.intro}
          </caption>
          <thead>
            <tr>
              <th scope="col" style={{ ...cellStyle, fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-secondary)' }}>
                {p.permissionColumn}
              </th>
              {catalog.roles.map((role) => (
                <th key={role.key} scope="col" style={headerCellStyle}>
                  <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-1)' }}>
                    <RoleLabel roleKey={role.key} name={role.name} />
                    <Badge tone={role.assignable ? 'success' : 'neutral'} size="sm">
                      {role.assignable ? p.assignable : p.notAssignable}
                    </Badge>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" style={{ ...cellStyle, fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-normal)', color: 'var(--text-primary)' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{row.resourceName}</span>
                  {' · '}
                  {row.actionName}
                </th>
                {catalog.roles.map((role) => {
                  const granted = grantedSets.get(role.key)?.has(row.key) ?? false
                  const label = t(granted ? p.grantedFor : p.notGrantedFor, { role: role.name })
                  return (
                    <td key={role.key} style={{ ...cellStyle, textAlign: 'center' }}>
                      <span
                        role="img"
                        aria-label={label}
                        title={label}
                        style={{
                          fontSize: 'var(--text-sm)',
                          color: granted ? 'var(--success-color)' : 'var(--text-tertiary)',
                        }}
                      >
                        {granted ? '✓' : '—'}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
        <span><span aria-hidden="true" style={{ color: 'var(--success-color)' }}>✓</span> {p.legendGranted}</span>
        <span><span aria-hidden="true">—</span> {p.legendNotGranted}</span>
      </div>
    </section>
  )
}

export default RolesPermissionsPanel
