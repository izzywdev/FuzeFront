import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  EmployeeConsoleFlow,
  createEmployeeClient,
  isEmployeeForbidden,
  assembleEmployeeOrgTree,
} from '@fuzefront/identity-ui'
import type { EmployeeOrgNode, EmployeeOrgListItem } from '@fuzefront/identity-ui'
import { useCurrentUser, type User } from '../lib/shared'
import { useFlag } from '../platform/featureFlags'
import { getActiveAuthToken } from '../lib/accounts'
import { isEmployeeUser } from '../utils/employee'

export const EMPLOYEE_CONSOLE_FLAG = 'fuzefront.identity.employee-console'

// The org-tree page walk fetches this many nodes per round-trip (server max
// 200, family default 50) — the explorer always assembles the FULL reachable
// tree client-side (no "load more" affordance in the frame), so a larger page
// just bounds the number of round-trips for a deep tree.
const ORGS_PAGE_LIMIT = 100

function displayName(user: Pick<User, 'firstName' | 'lastName' | 'email'> | null | undefined): string {
  if (!user) return ''
  const full = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
  return full || user.email
}

/**
 * `/staff` — the Employee cross-org explorer (FF-EPIC-17-S9,
 * design/frames/employee-console/01-org-explorer.html), flag
 * `fuzefront.identity.employee-console` (default OFF, shared with S8's
 * backend flag). Flag OFF: the route stays registered but renders nothing of
 * the surface — ships dark, mirrors `PortalsDirectory`'s convention.
 *
 * `isEmployee` gates the console itself (via `StaffGuard`, inside
 * `EmployeeConsoleFlow`). FF-EPIC-17-S9's contract gap (client-derived
 * `isEmployeeUser(roles)`, membership-scoped `GET /api/organizations`) is
 * closed as of PR #698 / `@fuzefront/security-client` 0.6.0:
 *
 * - The AUTHORITATIVE gate is `GET /v1/security/employee/status`
 *   (`getStatus()`) — server-resolved `resolveEmployeeStatus`, ReBAC
 *   `org-admin`-on-root only, never membership rows. `isEmployeeUser(roles)`
 *   is kept ONLY as a first-paint hint (see `statusHint` below) so a likely
 *   Employee doesn't flash the fail-closed notice while the status call is
 *   in flight; it never widens what StaffGuard ultimately renders.
 * - The explorer's org tree is `GET /v1/security/employee/orgs`
 *   (`listOrgs()`) — the ReBAC-authoritative reachable subtree (root +
 *   descendants), cursor-paginated. The host page-walks to
 *   `page.hasMore === false` and reassembles the tree via
 *   `assembleEmployeeOrgTree` (each item carries `parentOrgId`).
 */
function EmployeeConsolePage() {
  const enabled = useFlag(EMPLOYEE_CONSOLE_FLAG, false)
  if (!enabled) {
    return (
      <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>
        This area isn’t available yet.
      </div>
    )
  }
  return <EmployeeConsoleExplorerContent />
}

function EmployeeConsoleExplorerContent() {
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  // First-paint hint only — see the module doc above. Never the gate itself.
  const statusHint = isEmployeeUser(user?.roles)

  const client = useRef(createEmployeeClient({ getToken: getActiveAuthToken })).current

  const [isEmployee, setIsEmployee] = useState(statusHint)
  const [statusResolved, setStatusResolved] = useState(false)

  const [organizations, setOrganizations] = useState<EmployeeOrgNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadOrgs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const items: EmployeeOrgListItem[] = []
      let cursor: string | undefined
      for (;;) {
        const page = await client.listOrgs({ limit: ORGS_PAGE_LIMIT, cursor })
        items.push(...page.items)
        if (!page.page.hasMore || !page.page.nextCursor) break
        cursor = page.page.nextCursor
      }
      setOrganizations(assembleEmployeeOrgTree(items))
    } catch (err) {
      if (isEmployeeForbidden(err)) {
        // The role was revoked between the status check and this fetch —
        // fail closed rather than showing a stale/partial tree.
        setIsEmployee(false)
      } else {
        console.error('Failed to load the staff org tree:', err)
        setError('Failed to load the org tree')
      }
    } finally {
      setLoading(false)
    }
  }, [client])

  const loadStatus = useCallback(async () => {
    try {
      const status = await client.getStatus()
      setIsEmployee(status.isEmployee)
    } catch (err) {
      // Fail closed: an unresolved status is treated as "not staff" rather
      // than trusting the client-side hint indefinitely.
      console.error('Failed to resolve Employee status:', err)
      setIsEmployee(false)
    } finally {
      setStatusResolved(true)
    }
  }, [client])

  useEffect(() => {
    void loadStatus()
    // Only re-resolve if the client identity changes; `loadStatus` is stable
    // for the component's lifetime via `useCallback([client])`.
  }, [loadStatus])

  useEffect(() => {
    // Only fetch the cross-org tree once status is server-confirmed AND
    // positive — never on the optimistic first-paint hint alone, and never
    // for a non-Employee (StaffGuard never mounts the explorer for them
    // either way, so this also spares a wasted cross-org request the
    // fail-closed contract says they should never see).
    if (statusResolved && isEmployee) void loadOrgs()
  }, [statusResolved, isEmployee, loadOrgs])

  // While status is still resolving, `isEmployee` is the optimistic hint —
  // StaffGuard renders the explorer's own loading state for a likely
  // Employee, or the fail-closed notice immediately for a likely non-Employee
  // (which the real status can only confirm, never contradict downward).
  const showLoading = !statusResolved || (isEmployee && loading)

  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <EmployeeConsoleFlow
        isEmployee={isEmployee}
        view={{ kind: 'explorer' }}
        principalName={displayName(user)}
        organizations={organizations}
        loading={showLoading}
        error={statusResolved && isEmployee ? error : null}
        onRetry={() => void loadOrgs()}
        onSelectOrg={id => navigate(`/staff/orgs/${id}`)}
      />
    </div>
  )
}

export default EmployeeConsolePage
