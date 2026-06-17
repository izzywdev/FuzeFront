import { useState, useEffect } from 'react'
import { useCurrentUser } from '../lib/shared'
import { PermissionGate } from '../components/PermissionGate'
import { OrganizationSettings } from '../components/OrganizationSettings'
import { MembersManagement } from '../components/MembersManagement'
import {
  getOrganizations,
  getOrganizationMembers,
  createOrganization,
  updateOrganization,
  deleteOrganization,
} from '../services/api'

interface Organization {
  id: string
  name: string
  slug: string
  type: 'personal' | 'team' | 'enterprise'
  description?: string
  owner_id: string
  is_active: boolean
  settings: Record<string, any>
  metadata: Record<string, any>
  created_at: string
  updated_at: string
  member_count?: number
  user_role?: 'owner' | 'admin' | 'member' | 'viewer'
}

interface OrganizationMember {
  id: string
  user_id: string
  organization_id: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  status: 'active' | 'pending' | 'suspended'
  user: {
    id: string
    email: string
    firstName?: string
    lastName?: string
  }
  invited_at?: string
  joined_at?: string
}

function OrganizationPage() {
  const { user } = useCurrentUser()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null)
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [activeTab, setActiveTab] = useState<
    'overview' | 'members' | 'settings'
  >('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Mock data for now - will be replaced with API calls
    setTimeout(() => {
      setOrganizations([
        {
          id: '1',
          name: 'My Organization',
          slug: 'my-org',
          type: 'team',
          description: 'A sample organization',
          owner_id: user?.id || '',
          is_active: true,
          settings: {},
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          member_count: 5,
          user_role: 'owner',
        },
      ])
      setLoading(false)
    }, 1000)
  }, [user])

  // Load members when organization changes
  useEffect(() => {
    if (currentOrg) {
      loadMembers(currentOrg.id)
    }
  }, [currentOrg])

  const loadOrganizations = async () => {
    try {
      setLoading(true)
      const organizations = await getOrganizations()
      setOrganizations(organizations || [])

      // Set first organization as current if none selected
      if (organizations?.length > 0 && !currentOrg) {
        setCurrentOrg(organizations[0])
      }
    } catch (err) {
      setError('Failed to load organizations')
      console.error('Error loading organizations:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadMembers = async (organizationId: string) => {
    try {
      const members = await getOrganizationMembers(organizationId)
      setMembers(members || [])
    } catch (err) {
      console.error('Error loading members:', err)
    }
  }

  const handleCreateOrganization = async (orgData: Partial<Organization>) => {
    try {
      const newOrg = await createOrganization(orgData)
      setOrganizations(prev => [...prev, newOrg])
      setCurrentOrg(newOrg)
    } catch (err) {
      setError('Failed to create organization')
      console.error('Error creating organization:', err)
    }
  }

  const handleUpdateOrganization = async (
    orgId: string,
    updates: Partial<Organization>
  ) => {
    try {
      const updatedOrg = await updateOrganization(orgId, updates)
      setOrganizations(prev =>
        prev.map(org => (org.id === orgId ? { ...org, ...updatedOrg } : org))
      )
      if (currentOrg?.id === orgId) {
        setCurrentOrg(prev => (prev ? { ...prev, ...updatedOrg } : null))
      }
    } catch (err) {
      setError('Failed to update organization')
      console.error('Error updating organization:', err)
    }
  }

  const handleDeleteOrganization = async (orgId: string) => {
    try {
      await deleteOrganization(orgId)
      setOrganizations(prev => prev.filter(org => org.id !== orgId))

      // Switch to another organization if current was deleted
      if (currentOrg?.id === orgId) {
        const remaining = organizations.filter(org => org.id !== orgId)
        setCurrentOrg(remaining.length > 0 ? remaining[0] : null)
      }
    } catch (err) {
      setError('Failed to delete organization')
      console.error('Error deleting organization:', err)
    }
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner':
        return '👑'
      case 'admin':
        return '🛡️'
      case 'member':
        return '👤'
      case 'viewer':
        return '👁️'
      default:
        return '❓'
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'owner':
        return '#FFD700'
      case 'admin':
        return '#FF6B6B'
      case 'member':
        return '#4ECDC4'
      case 'viewer':
        return '#95A5A6'
      default:
        return '#BDC3C7'
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>🔄 Loading organizations...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--error-color)' }}>
        <div>❌ {error}</div>
        <button
          onClick={loadOrganizations}
          style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1>🏢 Organization Management</h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '1.1rem' }}>
          Manage your organizations, members, and settings
        </p>
      </div>

      {/* Organization Selector */}
      <div style={{ marginBottom: '2rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1rem',
          }}
        >
          <label htmlFor="org-select" style={{ fontWeight: 'bold' }}>
            Current Organization:
          </label>
          <select
            id="org-select"
            value={currentOrg?.id || ''}
            onChange={e => {
              const org = organizations.find(o => o.id === e.target.value)
              setCurrentOrg(org || null)
            }}
            style={{
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              minWidth: '200px',
            }}
          >
            {organizations.map(org => (
              <option key={org.id} value={org.id}>
                {org.name} ({org.type})
              </option>
            ))}
          </select>

          <PermissionGate requiredPermissions={['Organization:create']}>
            <button
              onClick={() => {
                const name = prompt('Organization name:')
                if (name) {
                  handleCreateOrganization({
                    name,
                    type: 'team',
                    description: `${name} organization`,
                  })
                }
              }}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: 'var(--accent-color)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              ➕ New Organization
            </button>
          </PermissionGate>
        </div>
      </div>

      {currentOrg && (
        <>
          {/* Organization Overview Card */}
          <div
            style={{
              padding: '1.5rem',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-tertiary)',
              marginBottom: '2rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'start',
              }}
            >
              <div>
                <h2
                  style={{
                    margin: '0 0 0.5rem 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {currentOrg.name}
                  <span
                    style={{
                      backgroundColor: getRoleBadgeColor(
                        currentOrg.user_role || 'viewer'
                      ),
                      color: 'white',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                    }}
                  >
                    {getRoleIcon(currentOrg.user_role || 'viewer')}{' '}
                    {currentOrg.user_role?.toUpperCase()}
                  </span>
                </h2>
                <p style={{ color: 'var(--text-tertiary)', margin: '0 0 1rem 0' }}>
                  {currentOrg.description || 'No description provided'}
                </p>
                <div
                  style={{
                    display: 'flex',
                    gap: '2rem',
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span>👥 {members.length} members</span>
                  <span>
                    📅 Created{' '}
                    {new Date(currentOrg.created_at).toLocaleDateString()}
                  </span>
                  <span>🏷️ {currentOrg.type}</span>
                  <span
                    style={{
                      color: currentOrg.is_active ? 'var(--success-color)' : 'var(--error-color)',
                    }}
                  >
                    {currentOrg.is_active ? '✅ Active' : '❌ Inactive'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div style={{ marginBottom: '2rem' }}>
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              {[
                { key: 'overview', label: '📊 Overview', icon: '📊' },
                { key: 'members', label: '👥 Members', icon: '👥' },
                { key: 'settings', label: '⚙️ Settings', icon: '⚙️' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as any)}
                  style={{
                    padding: '1rem 1.5rem',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: activeTab === tab.key ? 'var(--accent-color)' : 'var(--text-tertiary)',
                    borderBottom:
                      activeTab === tab.key
                        ? '2px solid var(--accent-color)'
                        : '2px solid transparent',
                    cursor: 'pointer',
                    fontSize: '1rem',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === 'overview' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '1.5rem',
              }}
            >
              {/* Quick Stats */}
              <div
                style={{
                  padding: '1.5rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-tertiary)',
                }}
              >
                <h3>📈 Quick Stats</h3>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  <div>
                    Total Members: <strong>{members.length}</strong>
                  </div>
                  <div>
                    Active Members:{' '}
                    <strong>
                      {members.filter(m => m.status === 'active').length}
                    </strong>
                  </div>
                  <div>
                    Pending Invites:{' '}
                    <strong>
                      {members.filter(m => m.status === 'pending').length}
                    </strong>
                  </div>
                  <div>
                    Organization Type: <strong>{currentOrg.type}</strong>
                  </div>
                </div>
              </div>

              {/* Recent Activity */}
              <div
                style={{
                  padding: '1.5rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-tertiary)',
                }}
              >
                <h3>📅 Recent Activity</h3>
                <div style={{ color: 'var(--text-tertiary)' }}>
                  <p>
                    • Organization created{' '}
                    {new Date(currentOrg.created_at).toLocaleDateString()}
                  </p>
                  <p>
                    • Last updated{' '}
                    {new Date(currentOrg.updated_at).toLocaleDateString()}
                  </p>
                  {members.length > 0 && (
                    <p>
                      • Latest member joined{' '}
                      {new Date(
                        Math.max(
                          ...members.map(m =>
                            new Date(
                              m.joined_at || m.invited_at || ''
                            ).getTime()
                          )
                        )
                      ).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'members' && (
            <MembersManagement
              organization={currentOrg}
              members={members}
              onMembersChange={() => loadMembers(currentOrg.id)}
            />
          )}

          {activeTab === 'settings' && (
            <PermissionGate
              requiredPermissions={['Organization:update']}
              fallback={
                <div
                  style={{
                    textAlign: 'center',
                    padding: '2rem',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  🔒 You don't have permission to view organization settings
                </div>
              }
            >
              <OrganizationSettings
                organization={currentOrg}
                onUpdate={updates =>
                  handleUpdateOrganization(currentOrg.id, updates)
                }
                onDelete={() => handleDeleteOrganization(currentOrg.id)}
              />
            </PermissionGate>
          )}
        </>
      )}

      {organizations.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-tertiary)' }}>
          <h2>🏢 No Organizations</h2>
          <p>You're not a member of any organizations yet.</p>
          <PermissionGate requiredPermissions={['Organization:create']}>
            <button
              onClick={() => {
                const name = prompt('Organization name:')
                if (name) {
                  handleCreateOrganization({
                    name,
                    type: 'team',
                    description: `${name} organization`,
                  })
                }
              }}
              style={{
                padding: '1rem 2rem',
                backgroundColor: 'var(--accent-color)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '1rem',
                marginTop: '1rem',
              }}
            >
              ➕ Create Your First Organization
            </button>
          </PermissionGate>
        </div>
      )}
    </div>
  )
}

export default OrganizationPage
