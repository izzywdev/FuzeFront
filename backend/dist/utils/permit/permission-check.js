'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.checkPermission = checkPermission
exports.bulkCheckPermissions = bulkCheckPermissions
exports.checkOrganizationPermission = checkOrganizationPermission
exports.checkAppPermission = checkAppPermission
exports.checkUserManagementPermission = checkUserManagementPermission
exports.checkOrganizationAccess = checkOrganizationAccess
exports.getUserPermissions = getUserPermissions
exports.requirePermission = requirePermission
const permit_1 = __importDefault(require('../../config/permit'))
/**
 * Checks if a user has permission to perform an action on a resource
 */
async function checkPermission(check) {
  try {
    const result = await permit_1.default.check(
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
async function bulkCheckPermissions(checks) {
  try {
    const bulkChecks = checks.map(check => ({
      user: check.user,
      action: check.action,
      resource: check.resource,
      context: check.context,
    }))
    const results = await permit_1.default.bulkCheck(bulkChecks)
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
async function checkOrganizationPermission(
  userId,
  action,
  organizationId,
  context
) {
  return checkPermission({
    user: userId,
    action,
    resource: {
      type: 'Organization',
      tenant: organizationId,
    },
    context,
  })
}
/**
 * Checks app-level permissions within an organization
 */
async function checkAppPermission(
  userId,
  action,
  appId,
  organizationId,
  context
) {
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
async function checkUserManagementPermission(
  userId,
  action,
  organizationId,
  targetUserId
) {
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
async function checkOrganizationAccess(userId, organizationId) {
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
async function getUserPermissions(userId, organizationId) {
  try {
    const permissions = await permit_1.default.getUserPermissions(userId, [
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
function requirePermission(action, resourceType, getTenant, getResourceKey) {
  return async (req, res, next) => {
    var _a
    try {
      if (!((_a = req.user) === null || _a === void 0 ? void 0 : _a.id)) {
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
//# sourceMappingURL=permission-check.js.map
