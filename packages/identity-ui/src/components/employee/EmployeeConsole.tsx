import { Button, Skeleton, StatusCallout } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { CrossOrgExplorer } from './CrossOrgExplorer'
import { OrgDrilldownPanel } from './OrgDrilldownPanel'
import type { EmployeeDirectMember, EmployeeOrgNode } from '../../types'

export type EmployeeConsoleView =
  | { kind: 'explorer' }
  | { kind: 'drilldown'; orgId: string; /** May be unresolved while `loading` is true. */ orgName?: string }

export interface EmployeeConsoleProps {
  view: EmployeeConsoleView
  principalName: string
  /** Explorer state (`view.kind === 'explorer'`). */
  organizations: EmployeeOrgNode[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onSelectOrg: (id: string) => void
  /** Drilldown state (`view.kind === 'drilldown'`). */
  directMembers?: EmployeeDirectMember[]
  membersLoading?: boolean
  membersError?: string | null
  onRetryMembers?: () => void
}

/**
 * Dispatches between the two employee-console screens the `employee-console`
 * flow covers — the cross-org explorer (frame a, `/staff`) and the org
 * drill-down (frame b, `/staff/orgs/:id`) — by `view`. Assumes the caller
 * already passed `StaffGuard`; this component renders no fail-closed state
 * of its own.
 */
export function EmployeeConsole({
  view,
  principalName,
  organizations,
  loading,
  error,
  onRetry,
  onSelectOrg,
  directMembers = [],
  membersLoading,
  membersError,
  onRetryMembers,
}: EmployeeConsoleProps) {
  const { messages } = useIdentityI18n()
  const e = messages.employeeConsole

  if (view.kind === 'drilldown') {
    // The org header (name) itself can still be resolving/failing — e.g. the
    // caller navigated straight to /staff/orgs/:id — independent of the
    // direct-members panel's own loading/error, which OrgDrilldownPanel owns.
    if (loading) {
      return (
        <div data-state="loading" aria-busy="true" aria-label={e.drilldownLoadingLabel} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Skeleton width="40%" height="var(--text-2xl)" />
          <Skeleton width="70%" height="var(--space-8)" />
        </div>
      )
    }
    if (error) {
      return (
        <div data-state="error">
          <StatusCallout
            tone="warning"
            title={e.drilldownErrorTitle}
            actions={
              <Button variant="ghost" data-action="retry" onClick={onRetry}>
                {messages.common.retry}
              </Button>
            }
          >
            {error}
          </StatusCallout>
        </div>
      )
    }
    return (
      <OrgDrilldownPanel
        orgId={view.orgId}
        orgName={view.orgName ?? ''}
        principalName={principalName}
        directMembers={directMembers}
        membersLoading={membersLoading}
        membersError={membersError}
        onRetryMembers={onRetryMembers}
      />
    )
  }

  return (
    <CrossOrgExplorer
      organizations={organizations}
      loading={loading}
      error={error}
      onRetry={onRetry}
      onSelectOrg={onSelectOrg}
    />
  )
}
