import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useCurrentUser } from '../lib/shared'
import { PermissionGate } from '../components/PermissionGate'
import { OrganizationSettings } from '../components/OrganizationSettings'
import { IdentityPage, OrgContextBadge } from '@fuzefront/identity-ui'
import {
  getOrganizations,
  getOrganizationMembers,
  updateOrganization,
  deleteOrganization,
} from '../services/api'
import { organizationErrorMessage } from '../utils/organization'

interface Organization {
  id: string
  name: string
  slug: string
  type: 'platform' | 'organization' | 'personal'
  description?: string
  owner_id: string
  is_active: boolean
  settings: Record<string, any>
  metadata: Record<string, any>
  created_at: string
  updated_at: string
  member_count?: number
  // `null` = visible-but-not-a-member (a platform org every authenticated
  // user can see); `undefined` = unknown (pre-#529 backend) — treat permissively.
  user_role?: 'owner' | 'admin' | 'member' | 'viewer' | null
}

interface OrganizationMember {
  id: string
  user_id: string
  organization_id: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  status: 'active' | 'pending' | 'suspended'
  user: { id: string; email: string; firstName?: string; lastName?: string }
  invited_at?: string
  joined_at?: string
}

/**
 * `/organizations/:id` (flag `fuzefront.identity.personal-context` ON) —
 * the per-org context home + Members/Settings tabs, reconciled with
 * 02-org-context.html: the access badge reflects the caller's REAL
 * `user_role` via `OrgContextBadge` — root shows MEMBER (never GUEST) once
 * the `fuzefront.identity.root-membership` backend slice writes a real
 * membership row; a genuinely-not-a-member visible platform org still shows
 * the honest "not a member" fallback below, never a fabricated role.
 *
 * Supersedes the per-org portion of OrganizationPage.tsx (its local
 * `<select>` moved to MyOrganizationsPage's canonical switcher/list).
 */
function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useCurrentUser()
  const navigate = useNavigate()
  const [org, setOrg] = useState<Organization | null>(null)
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'settings'>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadOrg = async () => {
    if (!id) return
    try {
      setLoading(true)
      setError(null)
      const orgs: Organization[] = await getOrganizations()
      const found = orgs.find(o => o.id === id) ?? null
      setOrg(found)
      if (!found) setError('Organization not found')
    } catch (err) {
      setError('Failed to load organization')
      console.error('Error loading organization:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOrg()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const loadMembers = async (organizationId: string) => {
    try {
      setMembers(await getOrganizationMembers(organizationId))
    } catch (err) {
      console.error('Error loading members:', err)
    }
  }

  useEffect(() => {
    if (org) void loadMembers(org.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id])

  const handleUpdate = async (updates: Partial<Organization>) => {
    if (!org) return
    try {
      const updated = await updateOrganization(org.id, updates)
      setOrg(prev => (prev ? { ...prev, ...updated } : prev))
    } catch (err) {
      setError(organizationErrorMessage(err, 'Failed to update organization'))
    }
  }

  const handleDelete = async () => {
    if (!org) return
    try {
      await deleteOrganization(org.id)
      navigate('/organizations')
    } catch (err) {
      setError(organizationErrorMessage(err, 'Failed to delete organization'))
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading organization…
      </div>
    )
  }

  if (error || !org) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--error-color)' }}>
        <div>{error ?? 'Organization not found'}</div>
        <button onClick={() => void loadOrg()} style={{ marginTop: 'var(--space-4)' }}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)' }}>{org.name}</h1>
        <OrgContextBadge context={{ type: 'org', role: org.user_role ?? null }} />
      </div>
      <p style={{ color: 'var(--text-tertiary)', margin: '0 0 var(--space-6)' }}>
        {org.description || 'No description provided'}
      </p>

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-4)',
          borderBottom: '1px solid var(--border-color)',
          marginBottom: 'var(--space-6)',
        }}
      >
        {(['overview', 'members', 'settings'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: 'var(--space-3) var(--space-4)',
              border: 'none',
              background: 'transparent',
              color: activeTab === tab ? 'var(--accent-color)' : 'var(--text-tertiary)',
              borderBottom: activeTab === tab ? '2px solid var(--accent-color)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: 'var(--text-md)',
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div style={{ color: 'var(--text-secondary)' }}>
          <p>Members: {members.length}</p>
          <p>Type: {org.type}</p>
          <p>Status: {org.is_active ? 'Active' : 'Inactive'}</p>
        </div>
      )}

      {activeTab === 'members' &&
        (org.user_role === null ? (
          <div
            style={{
              textAlign: 'center',
              padding: 'var(--space-12) var(--space-6)',
              color: 'var(--text-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-tertiary)',
            }}
          >
            <div style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>👋</div>
            <h3 style={{ margin: '0 0 var(--space-2)', color: 'var(--text-primary)' }}>
              You're not a member of this organization
            </h3>
            <p style={{ margin: 0 }}>
              You can see <strong>{org.name}</strong> because it's a platform organization, but you don't have a
              membership here, so its members, roles, and tokens aren't available to you. Ask an organization owner
              or admin for an invitation to gain access.
            </p>
          </div>
        ) : (
          <IdentityPage
            organizationId={org.id}
            userRole={org.user_role ?? 'viewer'}
            userId={user?.id}
            onMembersChange={() => void loadMembers(org.id)}
          />
        ))}

      {activeTab === 'settings' && (
        <PermissionGate
          requiredPermissions={['Organization:update']}
          fallback={
            <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-tertiary)' }}>
              🔒 You don't have permission to view organization settings
            </div>
          }
        >
          <OrganizationSettings organization={org} onUpdate={handleUpdate} onDelete={handleDelete} />
        </PermissionGate>
      )}
    </div>
  )
}

export default OrganizationDetailPage
