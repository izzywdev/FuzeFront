import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmployeeConsoleFlow, classifyOrgKind } from '@fuzefront/identity-ui'
import type { EmployeeOrgNode } from '@fuzefront/identity-ui'
import { useCurrentUser, ROOT_ORG_ID, type User } from '../lib/shared'
import { useFlag } from '../platform/featureFlags'
import { isEmployeeUser } from '../utils/employee'
import { getOrganizations } from '../services/api'
import type { Organization } from '../services/api'

export const EMPLOYEE_CONSOLE_FLAG = 'fuzefront.identity.employee-console'

function toEmployeeOrgNodes(orgs: Organization[]): EmployeeOrgNode[] {
  // `GET /api/organizations` already defaults to `is_active=true` server-side
  // (backend/src/routes/organizations.ts) — no client-side filter needed,
  // and the frontend's `Organization` type doesn't declare `is_active` today.
  return orgs.map(o => ({
    id: o.id,
    name: o.name,
    kind: classifyOrgKind({ id: o.id, parentId: o.parentId ?? null }, ROOT_ORG_ID),
    parentId: o.parentId ?? null,
    // Not projected by GET /api/organizations today — left unknown rather
    // than fabricated (OrgTreeRow renders '—').
    memberCount: o.member_count,
  }))
}

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
 * `EmployeeConsoleFlow`) — see `utils/employee.ts` for the client-side
 * derivation and its documented contract-gap caveat.
 *
 * CONTRACT GAP (flag in PR): `GET /api/organizations` is membership +
 * `type: 'platform'`-scoped, not a ReBAC cross-org tree read — for a pure
 * Employee (zero memberships) it returns only the platform-type org(s),
 * typically just root. Until a dedicated cross-org listing endpoint exists
 * (flagged for `contract-designer`/`backend-engineer` follow-up), the
 * explorer's real day-1 behavior for a pure Employee IS frame 03's "empty"
 * state — root reachable, nothing below it — which is honest, not a bug.
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
  const isEmployee = isEmployeeUser(user?.roles)

  const [organizations, setOrganizations] = useState<EmployeeOrgNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const orgs: Organization[] = await getOrganizations()
      setOrganizations(toEmployeeOrgNodes(orgs))
    } catch (err) {
      console.error('Failed to load the staff org tree:', err)
      setError('Failed to load the org tree')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // A non-Employee never triggers this fetch — StaffGuard (inside
    // EmployeeConsoleFlow) never mounts the explorer for them either way, so
    // this also spares a wasted cross-org request the fail-closed contract
    // says they should never see (manifest `commissionedByApproval`).
    if (isEmployee) void load()
  }, [isEmployee, load])

  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <EmployeeConsoleFlow
        isEmployee={isEmployee}
        view={{ kind: 'explorer' }}
        principalName={displayName(user)}
        organizations={organizations}
        loading={isEmployee && loading}
        error={isEmployee ? error : null}
        onRetry={() => void load()}
        onSelectOrg={id => navigate(`/staff/orgs/${id}`)}
      />
    </div>
  )
}

export default EmployeeConsolePage
