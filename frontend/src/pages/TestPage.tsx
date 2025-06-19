import React from 'react'
import { PermissionGate } from '../components/PermissionGate'
import {
  PermissionButton,
  AdminButton,
  OwnerButton,
  EditButton,
  DeleteButton,
} from '../components/PermissionButton'
import { OrganizationSelector } from '../components/OrganizationSelector'
import {
  RoleBadge,
  OwnerBadge,
  AdminBadge,
  MemberBadge,
  ViewerBadge,
  getRoleLevel,
  canManageRole,
} from '../components/RoleBadge'
import { UserProfileManagement } from '../components/UserProfileManagement'

export function TestPage() {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Permission Components Test</h1>

      {/* Organization Selector */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Organization Selector</h2>
        <OrganizationSelector
          onOrganizationChange={org =>
            console.log('Selected organization:', org)
          }
        />
      </section>

      {/* Role Badges - Phase 2 */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Role Badges (Phase 2)</h2>

        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-medium mb-2">Different Sizes</h3>
            <div className="flex items-center space-x-4">
              <RoleBadge role="owner" size="sm" />
              <RoleBadge role="admin" size="md" />
              <RoleBadge role="member" size="lg" />
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium mb-2">Different Variants</h3>
            <div className="flex items-center space-x-4">
              <RoleBadge role="owner" variant="solid" />
              <RoleBadge role="admin" variant="outline" />
              <RoleBadge role="member" variant="subtle" />
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium mb-2">All Roles</h3>
            <div className="flex flex-wrap gap-2">
              <OwnerBadge />
              <AdminBadge />
              <MemberBadge />
              <ViewerBadge />
              <RoleBadge role="moderator" />
              <RoleBadge role="guest" />
              <RoleBadge role="custom" />
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium mb-2">Interactive Badges</h3>
            <div className="flex items-center space-x-4">
              <RoleBadge
                role="admin"
                interactive
                onClick={() => alert('Admin badge clicked!')}
              />
              <RoleBadge
                role="member"
                interactive
                onClick={() => alert('Member badge clicked!')}
                variant="outline"
              />
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium mb-2">Role Management Logic</h3>
            <div className="bg-gray-50 p-4 rounded-md">
              <p className="text-sm text-gray-600 mb-2">Role Level Examples:</p>
              <ul className="text-sm space-y-1">
                <li>Owner level: {getRoleLevel('owner')}</li>
                <li>Admin level: {getRoleLevel('admin')}</li>
                <li>Member level: {getRoleLevel('member')}</li>
                <li>
                  Can admin manage member?{' '}
                  {canManageRole('admin', 'member') ? 'Yes' : 'No'}
                </li>
                <li>
                  Can member manage admin?{' '}
                  {canManageRole('member', 'admin') ? 'Yes' : 'No'}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* User Profile Management - Phase 2 */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">
          User Profile Management (Phase 2)
        </h2>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <UserProfileManagement
            onProfileUpdate={profile =>
              console.log('Profile updated:', profile)
            }
          />
        </div>
      </section>

      {/* Permission Gates */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Permission Gates</h2>

        <div className="space-y-4">
          <PermissionGate requiredRoles={['admin']}>
            <div className="p-4 bg-blue-100 rounded-md">
              <p className="text-blue-800">✅ You have admin access!</p>
            </div>
          </PermissionGate>

          <PermissionGate requiredRoles={['owner']}>
            <div className="p-4 bg-purple-100 rounded-md">
              <p className="text-purple-800">👑 You are an owner!</p>
            </div>
          </PermissionGate>

          <PermissionGate
            requiredRoles={['superuser']}
            fallback={
              <div className="p-4 bg-red-100 rounded-md">
                <p className="text-red-800">
                  ❌ You don't have superuser access
                </p>
              </div>
            }
          >
            <div className="p-4 bg-green-100 rounded-md">
              <p className="text-green-800">🚀 You have superuser access!</p>
            </div>
          </PermissionGate>
        </div>
      </section>

      {/* Permission Buttons */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Permission Buttons</h2>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <PermissionButton
              requiredPermission="Organization:create"
              onClick={() => alert('Creating organization...')}
              variant="primary"
            >
              Create Organization
            </PermissionButton>

            <AdminButton onClick={() => alert('Admin action!')}>
              Admin Action
            </AdminButton>

            <OwnerButton onClick={() => alert('Owner action!')}>
              Owner Action
            </OwnerButton>

            <EditButton onClick={() => alert('Editing...')}>Edit</EditButton>

            <DeleteButton onClick={() => alert('Deleting...')}>
              Delete
            </DeleteButton>
          </div>

          <div className="mt-4">
            <PermissionButton
              requiredPermission="nonexistent:permission"
              onClick={() => alert('This should not appear')}
              fallback={
                <div className="p-2 bg-gray-100 text-gray-600 rounded">
                  No permission for this action
                </div>
              }
            >
              Hidden Button
            </PermissionButton>
          </div>
        </div>
      </section>

      {/* Permission Checks */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Permission Checks</h2>

        <div className="space-y-2">
          <PermissionGate requiredPermissions={['Organization:read']}>
            <p className="text-green-600">✅ Can read organizations</p>
          </PermissionGate>

          <PermissionGate requiredPermissions={['Organization:create']}>
            <p className="text-green-600">✅ Can create organizations</p>
          </PermissionGate>

          <PermissionGate requiredPermissions={['Organization:delete']}>
            <p className="text-green-600">✅ Can delete organizations</p>
          </PermissionGate>

          <PermissionGate requiredPermissions={['UserManagement:invite']}>
            <p className="text-green-600">✅ Can invite users</p>
          </PermissionGate>

          <PermissionGate requiredPermissions={['App:install']}>
            <p className="text-green-600">✅ Can install apps</p>
          </PermissionGate>
        </div>
      </section>

      {/* Role-based Content */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Role-based Content</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PermissionGate requiredRoles={['admin', 'owner']} requireAll={false}>
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
              <h3 className="font-semibold text-blue-800">Admin/Owner Panel</h3>
              <p className="text-blue-600">
                Manage organization settings and users
              </p>
            </div>
          </PermissionGate>

          <PermissionGate requiredRoles={['member']} requireAll={false}>
            <div className="p-4 bg-green-50 border border-green-200 rounded-md">
              <h3 className="font-semibold text-green-800">Member Panel</h3>
              <p className="text-green-600">
                View and use organization resources
              </p>
            </div>
          </PermissionGate>
        </div>
      </section>

      {/* API Integration Status */}
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">API Integration Status</h2>

        <div className="bg-green-50 border border-green-200 rounded-md p-4">
          <h3 className="font-semibold text-green-800 mb-2">
            ✅ Connected to Backend API
          </h3>
          <ul className="text-green-700 text-sm space-y-1">
            <li>• Real permission checking via /api/auth/check-permissions</li>
            <li>• Organization management via /api/organizations</li>
            <li>• User role validation via /api/auth/user-roles</li>
            <li>• Member management operations</li>
            <li>• Permit.io integration for fine-grained permissions</li>
          </ul>
        </div>
      </section>
    </div>
  )
}

export default TestPage
