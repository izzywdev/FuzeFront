import React, { useState } from 'react'
import { PermissionGate } from './PermissionGate'

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
  user_role?: 'owner' | 'admin' | 'member' | 'viewer'
}

interface OrganizationSettingsProps {
  organization: Organization
  onUpdate: (updates: Partial<Organization>) => void
  onDelete: () => void
}

export function OrganizationSettings({
  organization,
  onUpdate,
  onDelete,
}: OrganizationSettingsProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
    name: organization.name,
    description: organization.description || '',
    type: organization.type,
    is_active: organization.is_active,
  })
  const [loading, setLoading] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  const handleSave = async () => {
    setLoading(true)
    try {
      await onUpdate(formData)
      setIsEditing(false)
    } catch (error) {
      console.error('Error updating organization:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    setLoading(true)
    try {
      await onDelete()
      setShowDeleteModal(false)
    } catch (error) {
      console.error('Error deleting organization:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '2rem' }}>
      {/* General Settings */}
      <div
        style={{
          padding: '1.5rem',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          backgroundColor: 'var(--bg-tertiary)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
          }}
        >
          <h3 style={{ margin: 0 }}>⚙️ General Settings</h3>

          <PermissionGate requiredPermissions={['Organization:update']}>
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                ✏️ Edit
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setIsEditing(false)}
                  style={{
                    padding: '0.5rem 1rem',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'transparent',
                    color: 'var(--text-tertiary)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={loading}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: 'var(--success-color)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  {loading ? '⏳ Saving...' : '💾 Save'}
                </button>
              </div>
            )}
          </PermissionGate>
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: 'bold',
              }}
            >
              Organization Name
            </label>
            {isEditing ? (
              <input
                type="text"
                value={formData.name}
                onChange={e =>
                  setFormData(prev => ({ ...prev, name: e.target.value }))
                }
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                }}
              />
            ) : (
              <div
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'var(--bg-quaternary)',
                  borderRadius: '4px',
                }}
              >
                {organization.name}
              </div>
            )}
          </div>

          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: 'bold',
              }}
            >
              Description
            </label>
            {isEditing ? (
              <textarea
                value={formData.description}
                onChange={e =>
                  setFormData(prev => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                rows={3}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  resize: 'vertical',
                }}
              />
            ) : (
              <div
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'var(--bg-quaternary)',
                  borderRadius: '4px',
                }}
              >
                {organization.description || 'No description provided'}
              </div>
            )}
          </div>

          {/* Organization Type */}
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: 'bold',
              }}
            >
              Organization Type
            </label>
            {isEditing ? (
              <select
                value={formData.type}
                onChange={e =>
                  setFormData(prev => ({
                    ...prev,
                    type: e.target.value as 'personal' | 'team' | 'enterprise',
                  }))
                }
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="personal">Personal</option>
                <option value="team">Team</option>
                <option value="enterprise">Enterprise</option>
              </select>
            ) : (
              <div
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'var(--bg-quaternary)',
                  borderRadius: '4px',
                }}
              >
                {organization.type.charAt(0).toUpperCase() +
                  organization.type.slice(1)}
              </div>
            )}
          </div>

          {/* Status */}
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: 'bold',
              }}
            >
              Status
            </label>
            {isEditing ? (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={e =>
                    setFormData(prev => ({
                      ...prev,
                      is_active: e.target.checked,
                    }))
                  }
                />
                <span>Organization is active</span>
              </label>
            ) : (
              <div
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'var(--bg-quaternary)',
                  borderRadius: '4px',
                  color: organization.is_active
                    ? 'var(--success-color)'
                    : 'var(--error-color)',
                }}
              >
                {organization.is_active ? '✅ Active' : '❌ Inactive'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Organization Information */}
      <div
        style={{
          padding: '1.5rem',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          backgroundColor: 'var(--bg-tertiary)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>📊 Organization Information</h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: 'bold',
                color: 'var(--text-tertiary)',
              }}
            >
              Organization ID
            </label>
            <div
              style={{
                padding: '0.75rem',
                backgroundColor: 'var(--bg-quaternary)',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
              }}
            >
              {organization.id}
            </div>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: 'bold',
                color: 'var(--text-tertiary)',
              }}
            >
              Slug
            </label>
            <div
              style={{
                padding: '0.75rem',
                backgroundColor: 'var(--bg-quaternary)',
                borderRadius: '4px',
              }}
            >
              {organization.slug}
            </div>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: 'bold',
                color: 'var(--text-tertiary)',
              }}
            >
              Created
            </label>
            <div
              style={{
                padding: '0.75rem',
                backgroundColor: 'var(--bg-quaternary)',
                borderRadius: '4px',
              }}
            >
              {new Date(organization.created_at).toLocaleDateString()}
            </div>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: 'bold',
                color: 'var(--text-tertiary)',
              }}
            >
              Last Updated
            </label>
            <div
              style={{
                padding: '0.75rem',
                backgroundColor: 'var(--bg-quaternary)',
                borderRadius: '4px',
              }}
            >
              {new Date(organization.updated_at).toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <PermissionGate requiredPermissions={['Organization:delete']}>
        <div
          style={{
            padding: '1.5rem',
            border: '1px solid var(--error-color)',
            borderRadius: '8px',
            backgroundColor: 'rgba(255, 68, 68, 0.05)',
          }}
        >
          <h3 style={{ marginTop: 0, color: 'var(--error-color)' }}>
            ⚠️ Danger Zone
          </h3>
          <p style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }}>
            Permanently delete this organization and all of its data.
          </p>

          <button
            onClick={() => setShowDeleteModal(true)}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: 'var(--error-color)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            🗑️ Delete Organization
          </button>
        </div>
      </PermissionGate>

      {showDeleteModal && (
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
              border: '1px solid var(--error-color)',
              minWidth: '400px',
            }}
          >
            <h3 style={{ marginTop: 0, color: 'var(--error-color)' }}>
              ⚠️ Confirm Deletion
            </h3>
            <p>
              Are you sure you want to delete{' '}
              <strong>{organization.name}</strong>?
            </p>

            <div
              style={{
                display: 'flex',
                gap: '1rem',
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={() => setShowDeleteModal(false)}
                style={{
                  padding: '0.75rem 1.5rem',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-tertiary)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: 'var(--error-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                {loading ? '⏳ Deleting...' : '🗑️ Delete Forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
