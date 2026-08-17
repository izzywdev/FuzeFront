import { StaffGuard } from './StaffGuard'
import { EmployeeConsole, type EmployeeConsoleView } from './EmployeeConsole'
import type { EmployeeDirectMember, EmployeeOrgNode } from '../../types'

export interface EmployeeConsoleFlowProps {
  /**
   * Whether the caller is an Employee. A host-resolved, controlled flag —
   * gate `fuzefront.identity.employee-console` OFF renders nothing at all
   * (the host never mounts this flow); flag ON + `isEmployee=false` renders
   * the fail-closed `NotStaffNotice` here, IN PLACE. See types.ts module doc
   * for how the host derives this today (client-side, from `user.roles`)
   * pending a server-authoritative employee-status endpoint.
   */
  isEmployee: boolean
  /** Which of the flow's two screens to render — `/staff` (explorer) or
   * `/staff/orgs/:id` (drilldown). Routing itself stays with the host. */
  view: EmployeeConsoleView
  /** Display name of the acting Employee (used by the inherited-access + banner copy). */
  principalName: string

  // Explorer state
  organizations: EmployeeOrgNode[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onSelectOrg: (id: string) => void

  // Drilldown state
  directMembers?: EmployeeDirectMember[]
  membersLoading?: boolean
  membersError?: string | null
  onRetryMembers?: () => void
}

/**
 * EmployeeConsoleFlow — the mountable orchestrator for the `employee-console`
 * flow (design/frames/employee-console/**, manifest `contract.component`).
 * Composes `StaffGuard` (the fail-closed gate) around `EmployeeConsole` (the
 * explorer/drilldown dispatcher). Fully controlled, mirroring
 * `ContextSwitcherFlow`/`MyOrganizationsFlow`: the host owns data fetching,
 * routing, and the `isEmployee` resolution; this component only renders.
 */
export function EmployeeConsoleFlow({
  isEmployee,
  view,
  principalName,
  organizations,
  loading,
  error,
  onRetry,
  onSelectOrg,
  directMembers,
  membersLoading,
  membersError,
  onRetryMembers,
}: EmployeeConsoleFlowProps) {
  return (
    <StaffGuard isEmployee={isEmployee}>
      <EmployeeConsole
        view={view}
        principalName={principalName}
        organizations={organizations}
        loading={loading}
        error={error}
        onRetry={onRetry}
        onSelectOrg={onSelectOrg}
        directMembers={directMembers}
        membersLoading={membersLoading}
        membersError={membersError}
        onRetryMembers={onRetryMembers}
      />
    </StaffGuard>
  )
}
