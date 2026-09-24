import permit from '../../config/permit'
import { logger } from '../../lib/logger'
import { BackendUser } from './user-sync'
import { Organization } from '../../types/shared'
import { PermitUser } from './user-sync'
import { PermitTenant } from './tenant-management'
import { RoleAssignment } from './role-assignment'

/**
 * Bulk sync users to Permit.io
 */
export async function bulkSyncUsers(
  users: BackendUser[]
): Promise<{ success: number; failed: number }> {
  const results = { success: 0, failed: 0 }

  try {
    const permitUsers: PermitUser[] = users.map(user => ({
      key: user.id,
      email: user.email,
      first_name:
        user.firstName ||
        user.username?.split(' ')[0] ||
        user.email.split('@')[0],
      last_name:
        user.lastName || user.username?.split(' ').slice(1).join(' ') || '',
      attributes: {
        created_at: user.created_at,
        updated_at: user.updated_at,
        roles: user.roles,
      },
    }))

    // Process in batches to avoid overwhelming the API
    const batchSize = 10
    for (let i = 0; i < permitUsers.length; i += batchSize) {
      const batch = permitUsers.slice(i, i + batchSize)

      const promises = batch.map(async permitUser => {
        try {
          await permit.api.users.sync(permitUser)
          results.success++
        } catch (error) {
          logger.error(
            { userId: permitUser.key, err: error },
            'permit: bulk user sync item failed'
          )
          results.failed++
        }
      })

      await Promise.all(promises)
    }

    logger.info(
      { succeeded: results.success, failed: results.failed },
      'permit: bulk user sync completed'
    )
  } catch (error) {
    logger.error({ err: error }, 'permit: bulk user sync failed')
  }

  return results
}

/**
 * Bulk sync organizations as tenants to Permit.io
 */
export async function bulkSyncTenants(
  organizations: Organization[]
): Promise<{ success: number; failed: number }> {
  const results = { success: 0, failed: 0 }

  try {
    const permitTenants: PermitTenant[] = organizations.map(org => ({
      key: org.id,
      name: org.name,
      description: `Organization: ${org.name} (${org.type})`,
      attributes: {
        slug: org.slug,
        type: org.type,
        parent_id: org.parent_id,
        owner_id: org.owner_id,
        settings: org.settings,
        metadata: org.metadata,
        is_active: org.is_active,
        created_at: org.created_at,
        updated_at: org.updated_at,
      },
    }))

    // Process in batches
    const batchSize = 10
    for (let i = 0; i < permitTenants.length; i += batchSize) {
      const batch = permitTenants.slice(i, i + batchSize)

      const promises = batch.map(async tenant => {
        try {
          await permit.api.tenants.create(tenant)
          results.success++
        } catch (error) {
          logger.error(
            { tenantId: tenant.key, err: error },
            'permit: bulk tenant sync item failed'
          )
          results.failed++
        }
      })

      await Promise.all(promises)
    }

    logger.info(
      { succeeded: results.success, failed: results.failed },
      'permit: bulk tenant sync completed'
    )
  } catch (error) {
    logger.error({ err: error }, 'permit: bulk tenant sync failed')
  }

  return results
}

/**
 * Bulk assign roles to users
 */
export async function bulkAssignRoles(
  assignments: RoleAssignment[]
): Promise<{ success: number; failed: number }> {
  const results = { success: 0, failed: 0 }

  try {
    // Process in batches
    const batchSize = 10
    for (let i = 0; i < assignments.length; i += batchSize) {
      const batch = assignments.slice(i, i + batchSize)

      const promises = batch.map(async assignment => {
        try {
          await permit.api.roleAssignments.assign(assignment)
          results.success++
        } catch (error) {
          logger.error(
            {
              role: assignment.role,
              userId: assignment.user,
              tenantId: assignment.tenant,
              err: error,
            },
            'permit: bulk role assignment item failed'
          )
          results.failed++
        }
      })

      await Promise.all(promises)
    }

    logger.info(
      { succeeded: results.success, failed: results.failed },
      'permit: bulk role assignment completed'
    )
  } catch (error) {
    logger.error({ err: error }, 'permit: bulk role assignment failed')
  }

  return results
}

/**
 * Complete organization setup with user roles
 */
export async function setupOrganizationWithRoles(
  organization: Organization,
  membershipData: Array<{
    userId: string
    role: 'owner' | 'admin' | 'member' | 'viewer' | 'developer'
  }>
): Promise<boolean> {
  try {
    // 1. Create tenant
    const tenant: PermitTenant = {
      key: organization.id,
      name: organization.name,
      description: `Organization: ${organization.name} (${organization.type})`,
      attributes: {
        slug: organization.slug,
        type: organization.type,
        parent_id: organization.parent_id,
        owner_id: organization.owner_id,
        settings: organization.settings,
        metadata: organization.metadata,
        is_active: organization.is_active,
        created_at: organization.created_at,
        updated_at: organization.updated_at,
      },
    }

    await permit.api.tenants.create(tenant)

    // 2. Assign roles to members
    const roleMapping: Record<string, string> = {
      owner: 'admin',
      admin: 'admin',
      member: 'editor',
      viewer: 'viewer',
    }

    const roleAssignments: RoleAssignment[] = membershipData.map(
      membership => ({
        user: membership.userId,
        role: roleMapping[membership.role] || 'viewer',
        tenant: organization.id,
      })
    )

    await bulkAssignRoles(roleAssignments)

    logger.info(
      { tenantId: organization.id, memberCount: membershipData.length },
      'permit: organization setup completed'
    )
    return true
  } catch (error) {
    logger.error(
      { tenantId: organization.id, err: error },
      'permit: organization setup failed'
    )
    return false
  }
}

/**
 * Sync all existing data to Permit.io (for initial setup)
 */
export async function initialDataSync(data: {
  users: BackendUser[]
  organizations: Organization[]
  memberships: Array<{
    userId: string
    organizationId: string
    role: 'owner' | 'admin' | 'member' | 'viewer' | 'developer'
  }>
}): Promise<{
  users: { success: number; failed: number }
  tenants: { success: number; failed: number }
  roles: { success: number; failed: number }
}> {
  logger.info('permit: initial data sync starting')

  // 1. Sync users first
  const userResults = await bulkSyncUsers(data.users)

  // 2. Sync organizations as tenants
  const tenantResults = await bulkSyncTenants(data.organizations)

  // 3. Setup role assignments
  const roleMapping: Record<string, string> = {
    owner: 'admin',
    admin: 'admin',
    member: 'editor',
    viewer: 'viewer',
  }

  const roleAssignments: RoleAssignment[] = data.memberships.map(
    membership => ({
      user: membership.userId,
      role: roleMapping[membership.role] || 'viewer',
      tenant: membership.organizationId,
    })
  )

  const roleResults = await bulkAssignRoles(roleAssignments)

  logger.info('permit: initial data sync completed')
  return {
    users: userResults,
    tenants: tenantResults,
    roles: roleResults,
  }
}
