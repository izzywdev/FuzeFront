import { useState } from 'react'
import { PermissionGate } from './PermissionGate'
import { PermissionButton, DeleteButton } from './PermissionButton'
import {
  inviteOrganizationMember,
  updateMemberRole,
  removeMember,
  type Organization,
} from '../services/api'

// Member shape this component consumes (provided by OrganizationPage): a nested
// `user` object plus status/timestamp fields.
interface OrganizationMember {
  id: string
  role: string
  status: string
  user: {
    id: string
    email: string
    firstName?: string
    lastName?: string
  }
  invited_at?: string
  joined_at?: string
}

interface MembersManagementProps {
  organization: Organization
  members: OrganizationMember[]
  onMembersChange: () => void
}

export function MembersManagement({
  organization,
  members,
  onMembersChange,
}: MembersManagementProps) {
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>(
    'member'
  )
  const [loading, setLoading] = useState(false)

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'var(--success-color)'
      case 'pending':
        return 'var(--warning-color)'
      case 'suspended':
        return 'var(--error-color)'
      default:
        return 'var(--text-tertiary)'
    }
  }

  const handleInviteUser = async () => {
    if (!inviteEmail.trim()) return

    setLoading(true)
    try {
      await inviteOrganizationMember(organization.id, {
        email: inviteEmail.trim(),
        role: inviteRole,
      })

      setInviteEmail('')
      setInviteRole('member')
      setShowInviteModal(false)
      onMembersChange()
    } catch (error) {
      console.error('Error inviting user:', error)
      // Could add toast notification here
    } finally {
      setLoading(false)
    }
  }

  const handleRoleChange = async (
    memberId: string,
    newRole: 'admin' | 'member' | 'viewer'
  ) => {
    setLoading(true)
    try {
      await updateMemberRole(organization.id, memberId, newRole)
      onMembersChange()
    } catch (error) {
      console.error('Error changing role:', error)
      // Could add toast notification here
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return

    setLoading(true)
    try {
      await removeMember(organization.id, memberId)
      onMembersChange()
    } catch (error) {
      console.error('Error removing member:', error)
      // Could add toast notification here
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {/* Header with invite button */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}
      >
        <h3>👥 Organization Members ({members.length})</h3>

        <PermissionButton
          requiredPermission="UserManagement:invite"
          onClick={() => setShowInviteModal(true)}
          variant="primary"
          className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700"
          loading={loading}
        >
          ➕ Invite Member
        </PermissionButton>
      </div>

      {/* Members List */}
      <div style={{ display: 'grid', gap: '1rem' }}>
        {members.map(member => (
          <div
            key={member.id}
            style={{
              padding: '1.5rem',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-tertiary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  marginBottom: '0.5rem',
                }}
              >
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--bg-quaternary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.2rem',
                  }}
                >
                  {member.user.firstName?.[0] ||
                    member.user.email[0].toUpperCase()}
                </div>

                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                    {member.user.firstName && member.user.lastName
                      ? `${member.user.firstName} ${member.user.lastName}`
                      : member.user.email}
                  </div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
                    {member.user.email}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: getRoleBadgeColor(member.role),
                    color: 'white',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  {getRoleIcon(member.role)} {member.role.toUpperCase()}
                </div>

                <div
                  style={{
                    backgroundColor: getStatusColor(member.status),
                    color: 'white',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '8px',
                    fontSize: '0.7rem',
                    fontWeight: 'bold',
                  }}
                >
                  {member.status.toUpperCase()}
                </div>
              </div>

              <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                {member.joined_at
                  ? `Joined: ${new Date(member.joined_at).toLocaleDateString()}`
                  : member.invited_at
                    ? `Invited: ${new Date(member.invited_at).toLocaleDateString()}`
                    : ''}
              </div>
            </div>

            {/* Actions */}
            <div
              style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
            >
              {/* Role Change Dropdown */}
              {member.role !== 'owner' && (
                <PermissionGate
                  requiredPermissions={['UserManagement:update_role']}
                >
                  <select
                    value={member.role}
                    onChange={e =>
                      handleRoleChange(
                        member.id,
                        e.target.value as 'admin' | 'member' | 'viewer'
                      )
                    }
                    disabled={loading}
                    style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.8rem',
                    }}
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </PermissionGate>
              )}

              {/* Remove Member Button */}
              {member.role !== 'owner' && (
                <DeleteButton
                  onClick={() => handleRemoveMember(member.id)}
                  loading={loading}
                  size="sm"
                >
                  Remove
                </DeleteButton>
              )}
            </div>
          </div>
        ))}

        {members.length === 0 && (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--text-tertiary)',
              border: '2px dashed var(--border-color)',
              borderRadius: '8px',
            }}
          >
            <h4>No members found</h4>
            <p>Invite members to get started with your organization.</p>
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'var(--shadow)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              padding: '2rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              minWidth: '400px',
              maxWidth: '500px',
            }}
          >
            <h3 style={{ marginBottom: '1.5rem' }}>Invite New Member</h3>

            <div style={{ marginBottom: '1rem' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '0.5rem',
                  fontWeight: 'bold',
                }}
              >
                Email Address
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="Enter email address"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-quaternary)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '0.5rem',
                  fontWeight: 'bold',
                }}
              >
                Role
              </label>
              <select
                value={inviteRole}
                onChange={e =>
                  setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')
                }
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-quaternary)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="admin">
                  Admin - Can manage organization and members
                </option>
                <option value="member">
                  Member - Can use organization resources
                </option>
                <option value="viewer">
                  Viewer - Can only view organization content
                </option>
              </select>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '1rem',
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={() => setShowInviteModal(false)}
                disabled={loading}
                style={{
                  padding: '0.75rem 1.5rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleInviteUser}
                disabled={!inviteEmail.trim() || loading}
                style={{
                  padding: '0.75rem 1.5rem',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: loading ? 'var(--bg-quaternary)' : 'var(--accent-color)',
                  color: 'white',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Inviting...' : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MembersManagement
