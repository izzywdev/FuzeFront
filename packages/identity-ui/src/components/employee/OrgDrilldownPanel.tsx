import { Badge, Button, RoleBadge, Skeleton, StatusCallout } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { StaffScopeSummary } from './StaffScopeSummary'
import { InheritedAccessPanel } from './InheritedAccessPanel'
import type { EmployeeDirectMember, OrgRole } from '../../types'

export interface OrgDrilldownPanelProps {
  orgId: string
  orgName: string
  /** Display name of the acting Employee, for the inherited-access panel. */
  principalName: string
  directMembers: EmployeeDirectMember[]
  membersLoading?: boolean
  membersError?: string | null
  onRetryMembers?: () => void
}

const KNOWN_ROLES = new Set(['owner', 'admin', 'member', 'viewer'])

function RoleLabel({ role }: { role: string }) {
  if (KNOWN_ROLES.has(role)) return <RoleBadge role={role as OrgRole} />
  return <Badge mono size="sm">{role}</Badge>
}

const cellStyle = {
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-color)',
  verticalAlign: 'middle' as const,
  textAlign: 'start' as const,
}

/**
 * Frame (b) — the org drill-down (02-org-drilldown.html), route
 * `/staff/orgs/:id`. The org's OWN direct-member list (`direct-members`) is
 * rendered plainly (no role-change/remove — this is a read-only staff view,
 * not member management), and the Employee is deliberately never in that
 * list (requirement #5 — see `InheritedAccessPanel`, the ONLY place their
 * access is surfaced, kept structurally separate).
 */
export function OrgDrilldownPanel({
  orgId,
  orgName,
  principalName,
  directMembers,
  membersLoading,
  membersError,
  onRetryMembers,
}: OrgDrilldownPanelProps) {
  const { messages } = useIdentityI18n()
  const e = messages.employeeConsole

  return (
    <div data-org={orgId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <StaffScopeSummary variant="drilldown" orgName={orgName} />
      <div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', color: 'var(--text-primary)' }}>
          {orgName}
        </h1>
        <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          {e.drilldownIntro}
        </p>
      </div>

      <section
        data-panel="direct-members"
        aria-labelledby="direct-members-heading"
        style={{
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <h2 id="direct-members-heading" style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', color: 'var(--text-primary)' }}>
            {e.directMembersTitle}
          </h2>
          <Badge tone="neutral" size="sm">{e.directOnlyBadge}</Badge>
        </div>

        {membersLoading ? (
          <div data-state="loading" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {[0, 1].map(i => <Skeleton key={i} height="var(--space-8)" />)}
          </div>
        ) : membersError ? (
          <div data-state="error">
            <StatusCallout
              tone="warning"
              title={e.membersErrorTitle}
              actions={
                <Button variant="ghost" data-action="retry" onClick={onRetryMembers}>
                  {messages.common.retry}
                </Button>
              }
            >
              {membersError}
            </StatusCallout>
          </div>
        ) : directMembers.length === 0 ? (
          <div data-state="empty">
            <StatusCallout tone="info" title={e.membersEmptyTitle}>{e.membersEmptyBody}</StatusCallout>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table data-list="direct-members" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th scope="col" style={cellStyle}>{e.colPerson}</th>
                  <th scope="col" style={cellStyle}>{e.colRole}</th>
                </tr>
              </thead>
              <tbody>
                {directMembers.map(m => (
                  <tr key={m.id} data-user={m.id}>
                    <td style={cellStyle}>{m.name}</td>
                    <td style={cellStyle}><RoleLabel role={m.role} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{e.directMembersAbsent}</p>
      </section>

      <InheritedAccessPanel principalName={principalName} orgName={orgName} />
    </div>
  )
}
