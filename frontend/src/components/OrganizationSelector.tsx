import React, { useState, useEffect } from 'react'
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

      // Set first organization as default if none selected
      if (!selectedOrg && formattedOrganizations.length > 0) {
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

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner':
        return 'bg-purple-100 text-purple-800'
      case 'admin':
        return 'bg-blue-100 text-blue-800'
      case 'member':
        return 'bg-green-100 text-green-800'
      case 'viewer':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  if (!isAuthenticated) {
    return null
  }

  if (isLoading) {
    return (
      <div className={`${compact ? 'w-48' : 'w-64'} ${className}`}>
        <div className="animate-pulse bg-gray-200 rounded-md h-10"></div>
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
              <div className="px-3 py-2 text-sm text-gray-500 text-center">
                No organizations found
              </div>
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
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${getRoleColor(org.role)}`}
                      >
                        {org.role}
                      </span>
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
      {showCreateModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity">
              <div
                className="absolute inset-0 bg-gray-500 opacity-75"
                onClick={() => setShowCreateModal(false)}
              ></div>
            </div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  Create New Organization
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Organization Name *
                    </label>
                    <input
                      type="text"
                      value={newOrgName}
                      onChange={e => setNewOrgName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter organization name"
                      maxLength={100}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <textarea
                      value={newOrgDescription}
                      onChange={e => setNewOrgDescription(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Optional description"
                      maxLength={500}
                    />
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  onClick={handleCreateOrganization}
                  disabled={!newOrgName.trim() || isCreating}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreating ? (
                    <>
                      <svg
                        className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Creating...
                    </>
                  ) : (
                    'Create'
                  )}
                </button>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default OrganizationSelector
