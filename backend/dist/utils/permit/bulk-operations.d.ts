import { BackendUser } from './user-sync'
import { Organization } from '../../types/shared'
import { RoleAssignment } from './role-assignment'
/**
 * Bulk sync users to Permit.io
 */
export declare function bulkSyncUsers(users: BackendUser[]): Promise<{
  success: number
  failed: number
}>
/**
 * Bulk sync organizations as tenants to Permit.io
 */
export declare function bulkSyncTenants(
  organizations: Organization[]
): Promise<{
  success: number
  failed: number
}>
/**
 * Bulk assign roles to users
 */
export declare function bulkAssignRoles(
  assignments: RoleAssignment[]
): Promise<{
  success: number
  failed: number
}>
/**
 * Complete organization setup with user roles
 */
export declare function setupOrganizationWithRoles(
  organization: Organization,
  membershipData: Array<{
    userId: string
    role: 'owner' | 'admin' | 'member' | 'viewer'
  }>
): Promise<boolean>
/**
 * Sync all existing data to Permit.io (for initial setup)
 */
export declare function initialDataSync(data: {
  users: BackendUser[]
  organizations: Organization[]
  memberships: Array<{
    userId: string
    organizationId: string
    role: 'owner' | 'admin' | 'member' | 'viewer'
  }>
}): Promise<{
  users: {
    success: number
    failed: number
  }
  tenants: {
    success: number
    failed: number
  }
  roles: {
    success: number
    failed: number
  }
}>
//# sourceMappingURL=bulk-operations.d.ts.map
