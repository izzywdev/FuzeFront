import permit from '../../config/permit'
import { db } from '../../config/database'

export interface PermissionCheck {
  user: string
  action: string
  resource: {
    type: string
    tenant: string
    key?: string
  }
  context?: Record<string, any>
}

/**
 * Checks if a user has permission to perform an action on a resource
 */
export async function checkPermission(
  check: PermissionCheck
): Promise<boolean> {
  try {
    const result = await permit.check(
      check.user,
      check.action,
      check.resource,
      check.context
    )

    console.log(
      `Permission check - User: ${check.user}, Action: ${check.action}, Resource: ${check.resource.type}, Result: ${result}`
    )
    return result
  } catch (error) {
    console.error('Error checking permission:', error)
    return false // Fail safe - deny access on error
  }
}

/**
 * Performs bulk permission checks for multiple resources
 */
export async function bulkCheckPermissions(
  checks: PermissionCheck[]
): Promise<boolean[]> {
  try {
    const bulkChecks = checks.map(check => ({
      user: check.user,
      action: check.action,
      resource: check.resource,
      context: check.context,
    }))

    const results = await permit.bulkCheck(bulkChecks)
    console.log(`Bulk permission check completed for ${checks.length} checks`)
    return results
  } catch (error) {
    console.error('Error in bulk permission check:', error)
    // Return all false for safety
    return new Array(checks.length).fill(false)
  }
}

/**
 * Checks organization-level permissions
 */
export async function checkOrganizationPermission(
  userId: string,
  action: 'create' | 'read' | 'update' | 'delete' | 'manage',
  organizationId: string,
  context?: Record<string, any>
): Promise<boolean> {
  const allowed = await checkPermission({
    user: userId,
    action,
    resource: {
      type: 'Organization',
      tenant: organizationId,
    },
    context,
  })
  if (allowed) return true

  // Authoritative DB-membership fallback. Permit.io role-sync can lag or miss on
  // provisioning (e.g. a freshly-provisioned personal org whose owner role never
  // synced), which would wrongly deny a legitimate owner. The
  // organization_memberships table is the source of truth the org list query
  // uses, so fall back to it: an ACTIVE member may 'read'; an active owner/admin
  // may 'update'/'delete'/'manage'. A non-member is still denied → BOLA holds.
  try {
    const membership = await db('organization_memberships')
      .where({
        user_id: userId,
        organization_id: organizationId,
        status: 'active',
      })
      .first()
    if (!membership) return false
    if (action === 'read') return true
    return ['owner', 'admin'].includes(membership.role)
  } catch (err) {
    console.error('Org-membership permission fallback failed:', err)
    return false
  }
}

/**
 * Checks app-level permissions within an organization
 */
export async function checkAppPermission(
  userId: string,
  action: 'create' | 'read' | 'update' | 'delete' | 'install' | 'uninstall',
  appId: string,
  organizationId: string,
  context?: Record<string, any>
): Promise<boolean> {
  return checkPermission({
    user: userId,
    action,
    resource: {
      type: 'App',
      tenant: organizationId,
      key: appId,
    },
    context,
  })
}

/**
 * Checks user management permissions within an organization
 */
export async function checkUserManagementPermission(
  userId: string,
  action: 'invite' | 'remove' | 'update_role' | 'view_members',
  organizationId: string,
  targetUserId?: string
): Promise<boolean> {
  return checkPermission({
    user: userId,
    action,
    resource: {
      type: 'UserManagement',
      tenant: organizationId,
    },
    context: targetUserId ? { target_user: targetUserId } : undefined,
  })
}

/**
 * Checks if user can access organization context
 */
export async function checkOrganizationAccess(
  userId: string,
  organizationId: string
): Promise<boolean> {
  return checkPermission({
    user: userId,
    action: 'read',
    resource: {
      type: 'Organization',
      tenant: organizationId,
    },
  })
}

/**
 * Gets all permissions for a user in an organization
 */
export async function getUserPermissions(
  userId: string,
  organizationId: string
) {
  try {
    const permissions = await permit.getUserPermissions(userId, [
      organizationId,
    ])
    return permissions
  } catch (error) {
    console.error(`Error getting user permissions for ${userId}:`, error)
    return {}
  }
}

/**
 * Middleware helper to check permissions in Express routes
 */
export function requirePermission(
  action: string,
  resourceType: string,
  getTenant: (req: any) => string,
  getResourceKey?: (req: any) => string
) {
  return async (req: any, res: any, next: any) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'Authentication required' })
      }

      const tenant = getTenant(req)
      if (!tenant) {
        return res.status(400).json({ error: 'Organization context required' })
      }

      const resourceKey = getResourceKey ? getResourceKey(req) : undefined

      const hasPermission = await checkPermission({
        user: req.user.id,
        action,
        resource: {
          type: resourceType,
          tenant,
          key: resourceKey,
        },
      })

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          required: { action, resource: resourceType, tenant },
        })
      }

      next()
    } catch (error) {
      console.error('Permission middleware error:', error)
      return res.status(500).json({ error: 'Permission check failed' })
    }
  }
}
