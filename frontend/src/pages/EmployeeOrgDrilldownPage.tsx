import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { EmployeeConsoleFlow, createEmployeeClient } from '@fuzefront/identity-ui'
import type { EmployeeDirectMember } from '@fuzefront/identity-ui'
import { useCurrentUser } from '../lib/shared'
import { useFlag } from '../platform/featureFlags'
import { getActiveAuthToken } from '../lib/accounts'
import { isEmployeeUser } from '../utils/employee'
import api, { getOrganization } from '../services/api'
import { EMPLOYEE_CONSOLE_FLAG } from './EmployeeConsolePage'

/**
 * Normalizes an `organization_memberships` row into `EmployeeDirectMember`.
 * `GET /api/organizations/:id/members` has TWO live shapes in this codebase
 * (`backend/src/routes/organizations.ts`'s cursor envelope `{items, page}`
 * vs. `backend/security/src/routes/organizations.ts`'s page/pageSize
 * envelope `{members, pagination}`) — tolerating both here, rather than
 * trusting `services/api.ts`'s `getOrganizationMembers()` (which only
 * unwraps `.members`), is the same defensive pattern
 * `@fuzefront/identity-ui`'s `identityClient.ts` already applies to this
 * exact drift. Flagged in the FF-EPIC-17-S9 PR for a backend-engineer
 * follow-up to converge on one envelope.
 */
function normalizeMember(row: any): EmployeeDirectMember {
  const user = row.user ?? {}
  const first = user.firstName ?? user.first_name
  const last = user.lastName ?? user.last_name
  const full = `${first ?? ''} ${last ?? ''}`.trim()
  return {
    id: row.membershipId ?? row.id,
    name: full || user.email || row.membershipId || row.id,
    email: user.email,
    role: row.role,
  }
}

async function fetchDirectMembers(orgId: string): Promise<EmployeeDirectMember[]> {
  const res = await api.get(`/organizations/${orgId}/members`)
  const raw = res.data
  const rows: any[] = Array.isArray(raw) ? raw : (raw?.items ?? raw?.members ?? [])
  return rows.map(normalizeMember)
}

/**
 * `/staff/orgs/:id` — the Employee org drill-down (FF-EPIC-17-S9,
 * design/frames/employee-console/02-org-drilldown.html), same flag as
 * `EmployeeConsolePage`. Flag OFF ships dark, same convention.
 *
 * `isEmployee` is now resolved the SAME way as the explorer (PR #698 /
 * `@fuzefront/security-client` 0.6.0): `getEmployeeStatus()` is the
 * AUTHORITATIVE gate; `isEmployeeUser(roles)` (`utils/employee.ts`) is kept
 * only as an optimistic first-paint hint. See `EmployeeConsolePage.tsx`'s
 * module doc for the full rationale — identical here.
 *
 * Unlike the explorer's org tree (now `GET /v1/security/employee/orgs` —
 * see `EmployeeConsolePage.tsx`), a single org's header
 * (`GET /api/organizations/:id`, via `getOrganization`) and its member list
 * (`GET /api/organizations/:id/members`) are both gated by
 * `PermissionMiddleware.canReadOrganization` (real Permit ReBAC), so they
 * already resolve correctly for an Employee's DERIVED access, with no
 * membership row required — unchanged by this rewire.
 */
function EmployeeOrgDrilldownPage() {
  const enabled = useFlag(EMPLOYEE_CONSOLE_FLAG, false)
  if (!enabled) {
    return (
      <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>
        This area isn’t available yet.
      </div>
    )
  }
  return <EmployeeOrgDrilldownContent />
}

function EmployeeOrgDrilldownContent() {
  const { id } = useParams<{ id: string }>()
  const { user } = useCurrentUser()
  const statusHint = isEmployeeUser(user?.roles)

  const client = useRef(createEmployeeClient({ getToken: getActiveAuthToken })).current
  const [isEmployee, setIsEmployee] = useState(statusHint)
  const [statusResolved, setStatusResolved] = useState(false)

  const [orgName, setOrgName] = useState<string | undefined>(undefined)
  const [orgLoading, setOrgLoading] = useState(true)
  const [orgError, setOrgError] = useState<string | null>(null)

  const [members, setMembers] = useState<EmployeeDirectMember[]>([])
  const [membersLoading, setMembersLoading] = useState(true)
  const [membersError, setMembersError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const status = await client.getStatus()
      setIsEmployee(status.isEmployee)
    } catch (err) {
      console.error('Failed to resolve Employee status:', err)
      setIsEmployee(false)
    } finally {
      setStatusResolved(true)
    }
  }, [client])

  const loadOrg = useCallback(async () => {
    if (!id) return
    setOrgLoading(true)
    setOrgError(null)
    try {
      const org = await getOrganization(id)
      setOrgName(org.name)
    } catch (err) {
      console.error('Failed to load organization:', err)
      setOrgError('Failed to load this organization')
    } finally {
      setOrgLoading(false)
    }
  }, [id])

  const loadMembers = useCallback(async () => {
    if (!id) return
    setMembersLoading(true)
    setMembersError(null)
    try {
      setMembers(await fetchDirectMembers(id))
    } catch (err) {
      console.error("Failed to load this org's members:", err)
      setMembersError("Failed to load this org's members")
    } finally {
      setMembersLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (statusResolved && isEmployee) {
      void loadOrg()
      void loadMembers()
    }
  }, [statusResolved, isEmployee, loadOrg, loadMembers])

  if (!id) return <Navigate to="/staff" replace />

  const showLoading = !statusResolved || (isEmployee && orgLoading)

  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <EmployeeConsoleFlow
        isEmployee={isEmployee}
        view={{ kind: 'drilldown', orgId: id, orgName }}
        principalName={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.email || ''}
        organizations={[]}
        loading={showLoading}
        error={statusResolved && isEmployee ? orgError : null}
        onRetry={() => void loadOrg()}
        onSelectOrg={() => {}}
        directMembers={members}
        membersLoading={isEmployee && membersLoading}
        membersError={isEmployee ? membersError : null}
        onRetryMembers={() => void loadMembers()}
      />
    </div>
  )
}

export default EmployeeOrgDrilldownPage
