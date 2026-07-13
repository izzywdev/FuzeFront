import React, { useState, useEffect } from 'react'
import { Skeleton, RoleBadge, Modal, EmptyState, Alert, Spinner } from '@fuzefront/design-system'
import { useCurrentUser } from '../lib/shared'
import { usePermissions } from './PermissionGate'
import {
  getOrganizations,
  createOrganization,
  type Organization as APIOrganization,
} from '../services/api'

interface Organization {
  id: string
  name: string
  description?: string
  role: string
  memberCount?: number
  createdAt: string
}

interface OrganizationSelectorProps {
  onOrganizationChange?: (organization: Organization | null) => void
  selectedOrganizationId?: string
  showCreateButton?: boolean
  compact?: boolean
  className?: string
}

export const OrganizationSelector: React.FC<OrganizationSelectorProps> = ({
  onOrganizationChange,
  selectedOrganizationId,
  showCreateButton = true,
  compact = false,
  className = '',
}) => {
  const { user, isAuthenticated } = useCurrentUser()
  const { hasPermission } = usePermissions()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [canCreateOrg, setCanCreateOrg] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newOrgName, setNewOrgName] = useState('')
  const [newOrgDescription, setNewOrgDescription] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    if (isAuthenticated && user) {
      loadOrganizations()
      checkCreatePermission()
    }
  }, [user, isAuthenticated])

  useEffect(() => {
    if (selectedOrganizationId && organizations.length > 0) {
      const org = organizations.find(o => o.id === selectedOrganizationId)
      if (org) {
        setSelectedOrg(org)
        onOrganizationChange?.(org)
      }
    }
  }, [selectedOrganizationId, organizations])

  const loadOrganizations = async () => {
    setIsLoading(true)
    try {
      const apiOrganizations = await getOrganizations()

      // Convert API organization format to component format
      const formattedOrganizations: Organization[] = apiOrganizations.map(
        (org: APIOrganization) => ({
          id: org.id,
          name: org.name,
          description: org.description,
          role: org.user_role || 'member',
          memberCount: org.member_count,
          createdAt: org.created_at,
        })
      )

      setOrganizations(formattedOrganizations)

      // Set first organization as default ONLY when the parent hasn't already
      // chosen one (selectedOrganizationId). Otherwise the auto-default would
      // override the persisted/active org the shell restored on load and switch
      // billing to the wrong org.
      if (
        !selectedOrg &&
        !selectedOrganizationId &&
        formattedOrganizations.length > 0
      ) {
        const defaultOrg = formattedOrganizations[0]
        setSelectedOrg(defaultOrg)
        onOrganizationChange?.(defaultOrg)
      }
    } catch (error) {
      console.error('Failed to load organizations:', error)
      // Fallback to empty array on error
      setOrganizations([])
    } finally {
      setIsLoading(false)
    }
  }

  const checkCreatePermission = async () => {
    try {
      const canCreate = await hasPermission('Organization:create')
      setCanCreateOrg(canCreate)
    } catch (error) {
      console.error('Failed to check create permission:', error)
      setCanCreateOrg(false)
    }
  }

  const handleOrganizationSelect = (org: Organization) => {
    setSelectedOrg(org)
    setIsDropdownOpen(false)
    onOrganizationChange?.(org)
  }

  const handleCreateOrganization = async () => {
    if (!newOrgName.trim()) return

    setIsCreating(true)
    try {
      const newApiOrg = await createOrganization({
        name: newOrgName.trim(),
        description: newOrgDescription.trim() || undefined,
        type: 'team',
      })

      // Convert to component format
      const newOrg: Organization = {
        id: newApiOrg.id,
        name: newApiOrg.name,
        description: newApiOrg.description,
        role: 'owner', // Creator becomes owner
        memberCount: 1,
        createdAt: newApiOrg.created_at,
      }

      setOrganizations(prev => [...prev, newOrg])
      setSelectedOrg(newOrg)
      onOrganizationChange?.(newOrg)

      // Reset form
      setNewOrgName('')
      setNewOrgDescription('')
      setShowCreateModal(false)
    } catch (error) {
      console.error('Failed to create organization:', error)
      // Could add toast notification here
    } finally {
      setIsCreating(false)
    }
  }

  if (!isAuthenticated) {
    return null
  }

  if (isLoading) {
    return (
      <div className={`${compact ? 'w-48' : 'w-64'} ${className}`}>
        <Skeleton height="40px" />
      </div>
    )
  }

  return (
    <div className={`relative ${compact ? 'w-48' : 'w-64'} ${className}`}>
      {/* Main Selector */}
      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-left hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <div className="flex-1 min-w-0">
          {selectedOrg ? (
            <div>
              <p
                className={`${compact ? 'text-sm' : 'text-base'} font-medium text-gray-900 truncate`}
              >
                {selectedOrg.name}
              </p>
              {!compact && (
                <p className="text-xs text-gray-500 truncate">
                  {selectedOrg.description ||
                    `${selectedOrg.memberCount} members`}
                </p>
              )}
            </div>
          ) : (
            <span className="text-gray-500">Select organization</span>
          )}
        </div>
        <svg
          className="ml-2 h-4 w-4 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown */}
      {isDropdownOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg">
          <div className="max-h-60 overflow-auto">
            {organizations.length === 0 ? (
              <EmptyState compact title="No organizations found" />
            ) : (
              organizations.map(org => (
                <button
                  key={org.id}
                  onClick={() => handleOrganizationSelect(org)}
                  className={`w-full px-3 py-2 text-left hover:bg-gray-50 focus:outline-none focus:bg-gray-50 ${
                    selectedOrg?.id === org.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {org.name}
                      </p>
                      {!compact && org.description && (
                        <p className="text-xs text-gray-500 truncate">
                          {org.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <RoleBadge role={org.role} />
                      {selectedOrg?.id === org.id && (
                        <svg
                          className="h-4 w-4 text-blue-600"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Create Organization Button */}
          {showCreateButton && canCreateOrg && (
            <div className="border-t border-gray-200">
              <button
                onClick={() => setShowCreateModal(true)}
                className="w-full px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 focus:outline-none focus:bg-blue-50 flex items-center"
              >
                <svg
                  className="mr-2 h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  />
                </svg>
                Create Organization
              </button>
            </div>
          )}
        </div>
      )}

      {/* Click outside to close */}
      {isDropdownOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsDropdownOpen(false)}
        />
      )}

      {/* Create Organization Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Organization"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
              Organization Name *
            </label>
            <input
              type="text"
              value={newOrgName}
              onChange={e => setNewOrgName(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.875rem' }}
              placeholder="Enter organization name"
              maxLength={100}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
              Description
            </label>
            <textarea
              value={newOrgDescription}
              onChange={e => setNewOrgDescription(e.target.value)}
              rows={3}
              style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.875rem', resize: 'vertical' }}
              placeholder="Optional description"
              maxLength={500}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button
              onClick={() => setShowCreateModal(false)}
              className="btn"
              style={{ background: 'var(--bg-quaternary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreateOrganization}
              disabled={!newOrgName.trim() || isCreating}
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {isCreating && <Spinner size={14} color="#fff" />}
              {isCreating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default OrganizationSelector
