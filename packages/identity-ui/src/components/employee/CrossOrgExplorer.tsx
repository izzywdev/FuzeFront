import { Button, Skeleton, StatusCallout } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { StaffScopeSummary } from './StaffScopeSummary'
import { OrgTreeRow } from './OrgTreeRow'
import type { EmployeeOrgNode } from '../../types'

export interface CrossOrgExplorerProps {
  /** Every reachable org, INCLUDING the root row when resolvable. */
  organizations: EmployeeOrgNode[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onSelectOrg: (id: string) => void
}

/**
 * Frame (a) — the cross-org explorer (01-org-explorer.html), route `/staff`.
 * Renders the staff banner + reachable-org table, plus the loading / empty /
 * error states from 03-states.html (c1–c3). The fail-closed non-Employee
 * state (c4) lives one level up in `StaffGuard` — this component assumes the
 * caller already passed that gate.
 */
export function CrossOrgExplorer({ organizations, loading, error, onRetry, onSelectOrg }: CrossOrgExplorerProps) {
  const { messages } = useIdentityI18n()
  const e = messages.employeeConsole

  const beyondRoot = organizations.filter(o => o.kind !== 'root')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <StaffScopeSummary variant="explorer" />
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-2xl)',
            color: 'var(--text-primary)',
          }}
        >
          {e.explorerTitle}
        </h1>
        <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          {e.explorerIntro}
        </p>
      </div>

      {loading ? (
        <div data-state="loading" aria-busy="true" aria-label={e.loadingLabel} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[0, 1, 2].map(i => (
            <Skeleton key={i} width={i === 0 ? '55%' : i === 1 ? '85%' : '70%'} height="var(--space-8)" />
          ))}
        </div>
      ) : error ? (
        <div data-state="error">
          <StatusCallout
            tone="warning"
            title={e.errorTitle}
            actions={
              <Button variant="ghost" data-action="retry" onClick={onRetry}>
                {messages.common.retry}
              </Button>
            }
          >
            {error}
          </StatusCallout>
        </div>
      ) : (
        <>
          {organizations.length > 0 && (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
              <table
                data-panel="org-explorer"
                data-list="reachable-orgs"
                style={{ width: '100%', borderCollapse: 'collapse' }}
              >
                <thead>
                  <tr>
                    <th scope="col" style={headerCellStyle}>{e.colOrganization}</th>
                    <th scope="col" style={headerCellStyle}>{e.colKind}</th>
                    <th scope="col" style={headerCellStyle}>{e.colMembers}</th>
                    <th scope="col" style={headerCellStyle}>{e.colAccess}</th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map(org => (
                    <OrgTreeRow key={org.id} org={org} onSelect={onSelectOrg} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {beyondRoot.length === 0 ? (
            <div data-state="empty">
              <StatusCallout tone="info" icon={<span aria-hidden="true">🛰️</span>} title={e.emptyTitle}>
                {e.emptyBody}
              </StatusCallout>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
              {e.derivedFootnote}
            </p>
          )}
        </>
      )}
    </div>
  )
}

const headerCellStyle = {
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-color)',
  textAlign: 'start' as const,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-medium)',
  color: 'var(--text-secondary)',
}
