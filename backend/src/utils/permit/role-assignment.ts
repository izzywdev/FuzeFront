import permit from '../../config/permit'

export interface RoleAssignment {
  user: string
  role: string
  tenant: string
  resource_instance?: string
}

/**
 * Assigns a role to a user in an organization (tenant)
 */
export async function assignRoleInPermit(
  assignment: RoleAssignment
): Promise<boolean> {
  try {
    await permit.api.roleAssignments.assign(assignment)
    console.log(
      `Role ${assignment.role} assigned to user ${assignment.user} in tenant ${assignment.tenant}`
    )
    return true
  } catch (error) {
    console.error(
      `Error assigning role ${assignment.role} to user ${assignment.user}:`,
      error
    )
    return false
  }
}

/**
 * Unassigns a role from a user in an organization (tenant)
 */
export async function unassignRoleInPermit(
  assignment: Omit<RoleAssignment, 'resource_instance'>
): Promise<boolean> {
  try {
    await permit.api.roleAssignments.unassign(assignment)
    console.log(
      `Role ${assignment.role} unassigned from user ${assignment.user} in tenant ${assignment.tenant}`
    )
    return true
  } catch (error) {
    console.error(
      `Error unassigning role ${assignment.role} from user ${assignment.user}:`,
      error
    )
    return false
  }
}

/**
 * Lists all role assignments for a user
 */
export async function getUserRoleAssignments(
  userId: string,
  tenantId?: string
) {
  try {
    const filter = tenantId
      ? { user: userId, tenant: tenantId }
      : { user: userId }
    const assignments = await permit.api.roleAssignments.list(filter)
    return assignments
  } catch (error) {
    console.error(`Error getting role assignments for user ${userId}:`, error)
    return []
  }
}

/**
 * Lists all role assignments in a tenant
 */
export async function getTenantRoleAssignments(tenantId: string) {
  try {
    const assignments = await permit.api.roleAssignments.list({
      tenant: tenantId,
    })
    return assignments
  } catch (error) {
    console.error(
      `Error getting role assignments for tenant ${tenantId}:`,
      error
    )
    return []
  }
}

/**
 * Checks if a user has a specific role in a tenant
 */
export async function userHasRole(
  userId: string,
  role: string,
  tenantId: string
): Promise<boolean> {
  try {
    const assignments = await getUserRoleAssignments(userId, tenantId)
    return assignments.some(
      (assignment: any) =>
        assignment.role === role && assignment.tenant === tenantId
    )
  } catch (error) {
    console.error(`Error checking if user ${userId} has role ${role}:`, error)
    return false
  }
}

/**
 * Assigns organization membership roles based on membership role
 */
export async function assignOrganizationRole(
  userId: string,
  organizationId: string,
  membershipRole: 'owner' | 'admin' | 'member' | 'viewer'
): Promise<boolean> {
  try {
    // Map membership roles to Permit roles
    const roleMapping: Record<string, string> = {
      owner: 'admin', // Organization owners get admin permissions
      admin: 'admin', // Admins get admin permissions
      member: 'editor', // Members get editor permissions
      viewer: 'viewer', // Viewers get view-only permissions
    }

    const permitRole = roleMapping[membershipRole] || 'viewer'

    return await assignRoleInPermit({
      user: userId,
      role: permitRole,
      tenant: organizationId,
    })
  } catch (error) {
    console.error(
      `Error assigning organization role for user ${userId}:`,
      error
    )
    return false
  }
}

/**
 * Updates user role when membership role changes
 */
export async function updateOrganizationRole(
  userId: string,
  organizationId: string,
  oldRole: string,
  newRole: string
): Promise<boolean> {
  try {
    // First unassign the old role
    const roleMapping: Record<string, string> = {
      owner: 'admin',
      admin: 'admin',
      member: 'editor',
      viewer: 'viewer',
    }

    const oldPermitRole = roleMapping[oldRole] || 'viewer'
    const newPermitRole = roleMapping[newRole] || 'viewer'

    if (oldPermitRole !== newPermitRole) {
      await unassignRoleInPermit({
        user: userId,
        role: oldPermitRole,
        tenant: organizationId,
      })

      await assignRoleInPermit({
        user: userId,
        role: newPermitRole,
        tenant: organizationId,
      })
    }

    return true
  } catch (error) {
    console.error(`Error updating organization role for user ${userId}:`, error)
    return false
  }
}
