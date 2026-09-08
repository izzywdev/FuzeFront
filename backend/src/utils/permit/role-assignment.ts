import permit from '../../config/permit'

// Strips CR/LF before a value reaches a log line (CodeQL js/log-injection —
// an embedded newline could forge additional fake log lines). Same idiom as
// routes/auth.ts and middleware/auth.ts: the constant-format-string + %s args
// pattern below defeats format-string injection but not this, since
// console.log writes %s args verbatim with no escaping.
const oneLine = (v: unknown) => String(v).replace(/[\r\n]+/g, ' ')

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
    // Constant format string + %s args (log injection / unsafe-formatstring):
    // assignment.role/user/tenant are never interpolated into the format
    // string itself, so a stray %s/%d in one of them can't forge the rest
    // of the log line.
    console.log(
      'Role %s assigned to user %s in tenant %s',
      oneLine(assignment.role),
      oneLine(assignment.user),
      oneLine(assignment.tenant)
    )
    return true
  } catch (error) {
    console.error(
      'Error assigning role %s to user %s:',
      oneLine(assignment.role),
      oneLine(assignment.user),
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
      'Role %s unassigned from user %s in tenant %s',
      oneLine(assignment.role),
      oneLine(assignment.user),
      oneLine(assignment.tenant)
    )
    return true
  } catch (error) {
    console.error(
      'Error unassigning role %s from user %s:',
      oneLine(assignment.role),
      oneLine(assignment.user),
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
    console.error('Error getting role assignments for user %s:', oneLine(userId), error)
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
    console.error('Error getting role assignments for tenant %s:', oneLine(tenantId), error)
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
    console.error('Error checking if user %s has role %s:', oneLine(userId), oneLine(role), error)
    return false
  }
}

/**
 * Assigns organization membership roles based on membership role
 */
export async function assignOrganizationRole(
  userId: string,
  organizationId: string,
  membershipRole: 'owner' | 'admin' | 'member' | 'viewer' | 'developer'
): Promise<boolean> {
  try {
    // Map membership roles to Permit roles
    const roleMapping: Record<string, string> = {
      owner: 'admin', // Organization owners get admin permissions
      admin: 'admin', // Admins get admin permissions
      member: 'editor', // Members get editor permissions
      viewer: 'viewer', // Viewers get view-only permissions
      developer: 'developer', // docs/planning/developers-portal.md §5.3 — catalog + sandbox only
    }

    const permitRole = roleMapping[membershipRole] || 'viewer'

    return await assignRoleInPermit({
      user: userId,
      role: permitRole,
      tenant: organizationId,
    })
  } catch (error) {
    console.error('Error assigning organization role for user %s:', oneLine(userId), error)
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
      developer: 'developer',
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
    console.error('Error updating organization role for user %s:', oneLine(userId), error)
    return false
  }
}
