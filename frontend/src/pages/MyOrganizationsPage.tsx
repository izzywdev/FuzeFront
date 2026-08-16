import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MyOrganizationsFlow } from '@fuzefront/identity-ui'
import { useAppContext, useOrganizations, ROOT_ORG_ID } from '../lib/shared'
import { getOrganizations, createOrganization } from '../services/api'
import { organizationErrorMessage } from '../utils/organization'
import { usePermissions } from '../components/PermissionGate'
import type { Organization } from '../services/api'
import type { OrgContextItem } from '@fuzefront/identity-ui'

function toContextItems(orgs: Organization[]): OrgContextItem[] {
  return orgs.map(org => ({
    id: org.id,
    name: org.name,
    role: (org.user_role as OrgContextItem['role']) ?? null,
    isRoot: org.id === ROOT_ORG_ID,
    isPortal: org.id !== ROOT_ORG_ID && org.parentId === ROOT_ORG_ID,
    parentId: org.parentId ?? null,
  }))
}

/**
 * `/organizations` (flag `fuzefront.identity.personal-context` ON) —
 * "My orgs & sub-orgs" (design/frames/identity-context-switcher,
 * 04-my-orgs.html, flow `my-orgs`). Supersedes OrganizationPage.tsx's local
 * `<select>` — this is the canonical place to browse/switch the orgs and
 * sub-orgs the caller directly belongs to; per-org management (Members/
 * Settings) lives at `/organizations/:id` (OrganizationDetailPage).
 */
function MyOrganizationsPage() {
  const navigate = useNavigate()
  const { dispatch } = useAppContext()
  const { organizations: contextOrganizations, setActiveOrganization } = useOrganizations()
  const { hasPermission } = usePermissions()

  const [fetched, setFetched] = useState<Organization[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [canCreate, setCanCreate] = useState(true)

  const organizations = fetched ?? contextOrganizations

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setFetched(await getOrganizations())
    } catch (err) {
      console.error('Failed to load organizations:', err)
      setError('Failed to load organizations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    hasPermission('Organization:create')
      .then(allowed => {
        if (!cancelled) setCanCreate(allowed)
      })
      .catch(() => {
        if (!cancelled) setCanCreate(false)
      })
    return () => {
      cancelled = true
    }
  }, [hasPermission])

  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <MyOrganizationsFlow
        organizations={toContextItems(organizations)}
        rootOrgId={ROOT_ORG_ID}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        canCreate={canCreate}
        onOpenOrg={id => navigate(`/organizations/${id}`)}
        onCreate={async input => {
          try {
            const org = await createOrganization({ name: input.name, slug: input.slug, type: 'organization' })
            return { id: org.id, name: org.name }
          } catch (err) {
            throw new Error(organizationErrorMessage(err, 'Failed to create organization'))
          }
        }}
        onCreated={org => {
          const next = [...organizations, org as unknown as Organization]
          setFetched(next)
          dispatch({ type: 'SET_ORGANIZATIONS', payload: next })
          setActiveOrganization(org.id)
        }}
      />
    </div>
  )
}

export default MyOrganizationsPage
