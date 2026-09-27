import permit from '../../config/permit'
import { logger } from '../../lib/logger'

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
    logger.info(
      {
        role: assignment.role,
        user: assignment.user,
        tenant: assignment.tenant,
      },
      'permit role assigned to user in tenant'
    )
    return true
  } catch (error) {
    logger.error(
      { err: error, role: assignment.role, user: assignment.user },
      'error assigning permit role to user'
    )
    return false
  }
}

/**
 * Unassigns a role from a user in an organization (tenant).
 *
 * `resource_instance` IS accepted (unlike an earlier revision of this
 * signature, which omitted it): Permit identifies a role assignment by the
 * full (user, role, tenant, resource_instance) tuple, so an instance-scoped
 * assignment (ReBAC, e.g. `SelectionList:sl_123`) is a DIFFERENT record from
 * the tenant-wide one and is not removed by an unassign call that leaves
 * `resource_instance` off. Dropping it silently no-ops the revocation of a
 * scoped grant while still returning success — a caller believes access was
 * revoked when Permit's state is unchanged. See
 * `PermitAuthorizationProvider.revoke()`, the only caller that has a
 * `resource` to pass; the organization-role helpers below intentionally
 * never scope by instance and are unaffected by this being optional.
 */
export async function unassignRoleInPermit(
  assignment: RoleAssignment
): Promise<boolean> {
  try {
    await permit.api.roleAssignments.unassign(assignment)
    logger.info(
      {
        role: assignment.role,
        user: assignment.user,
        tenant: assignment.tenant,
      },
      'permit role unassigned from user in tenant'
    )
    return true
  } catch (error) {
    logger.error(
      { err: error, role: assignment.role, user: assignment.user },
      'error unassigning permit role from user'
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
    logger.error(
      { err: error, user: userId, tenant: tenantId },
      'error getting role assignments for user'
    )
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
    logger.error(
      { err: error, tenant: tenantId },
      'error getting role assignments for tenant'
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
    logger.error(
      { err: error, user: userId, role, tenant: tenantId },
      'error checking whether user has role'
    )
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
    logger.error(
      { err: error, user: userId, organizationId, membershipRole },
      'error assigning organization role for user'
    )
    return false
  }
}

/**
 * Unassigns the Permit role that corresponds to a membership role — the mirror
 * of `assignOrganizationRole` (same role mapping). Best-effort: returns false
 * rather than throwing.
 */
export async function unassignOrganizationRole(
  userId: string,
  organizationId: string,
  membershipRole: 'owner' | 'admin' | 'member' | 'viewer' | 'developer'
): Promise<boolean> {
  try {
    // Same mapping as assignOrganizationRole.
    const roleMapping: Record<string, string> = {
      owner: 'admin',
      admin: 'admin',
      member: 'editor',
      viewer: 'viewer',
      developer: 'developer',
    }

    const permitRole = roleMapping[membershipRole] || 'viewer'

    return await unassignRoleInPermit({
      user: userId,
      role: permitRole,
      tenant: organizationId,
    })
  } catch (error) {
    logger.error(
      { err: error, user: userId, organizationId, membershipRole },
      'error unassigning organization role for user'
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
    logger.error(
      { err: error, user: userId, organizationId, oldRole, newRole },
      'error updating organization role for user'
    )
    return false
  }
}
