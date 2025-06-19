import { Request, Response, NextFunction } from 'express'
import {
  checkPermission,
  checkOrganizationPermission,
  checkAppPermission,
  checkUserManagementPermission,
} from '../utils/permit/permission-check'

// Extend Express Request type to include user and organization context
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email: string
    roles: string[]
    organizationId?: string
  }
  organization?: {
    id: string
    role: string
  }
}

export interface PermissionConfig {
  resource: string
  action: string
  getTenant?: (req: AuthenticatedRequest) => string
  getResourceKey?: (req: AuthenticatedRequest) => string | undefined
  fallbackToPublic?: boolean
  requireOrganizationContext?: boolean
}

/**
 * Generic permission middleware factory
 */
export function requirePermission(config: PermissionConfig) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      // Check authentication
      if (!req.user?.id) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        })
      }

      // Get tenant (organization) context
      let tenant: string
      if (config.getTenant) {
        tenant = config.getTenant(req)
      } else if (req.params.organizationId) {
        tenant = req.params.organizationId
      } else if (req.user.organizationId) {
        tenant = req.user.organizationId
      } else if (config.requireOrganizationContext) {
        return res.status(400).json({
          error: 'Organization context required',
          code: 'ORG_CONTEXT_REQUIRED',
        })
      } else {
        // No tenant context, skip permission check if fallback allowed
        if (config.fallbackToPublic) {
          return next()
        }
        return res.status(400).json({
          error: 'Organization context required',
          code: 'ORG_CONTEXT_REQUIRED',
        })
      }

      // Get resource key if needed
      const resourceKey = config.getResourceKey
        ? config.getResourceKey(req)
        : undefined

      // Check permission
      const hasPermission = await checkPermission({
        user: req.user.id,
        action: config.action,
        resource: {
          type: config.resource,
          tenant,
          key: resourceKey,
        },
      })

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          code: 'PERMISSION_DENIED',
          required: {
            action: config.action,
            resource: config.resource,
            tenant,
            resourceKey,
          },
        })
      }

      // Add organization context to request for downstream handlers
      req.organization = { id: tenant, role: 'unknown' }
      next()
    } catch (error) {
      console.error('Permission middleware error:', error)
      return res.status(500).json({
        error: 'Permission check failed',
        code: 'PERMISSION_CHECK_ERROR',
      })
    }
  }
}

/**
 * Organization-specific permission middleware
 */
export function requireOrganizationPermission(
  action: 'create' | 'read' | 'update' | 'delete' | 'manage'
) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        })
      }

      const organizationId = req.params.organizationId || req.params.id
      if (!organizationId) {
        return res.status(400).json({
          error: 'Organization ID required',
          code: 'ORG_ID_REQUIRED',
        })
      }

      const hasPermission = await checkOrganizationPermission(
        req.user.id,
        action,
        organizationId
      )

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Insufficient organization permissions',
          code: 'ORG_PERMISSION_DENIED',
          required: { action, organizationId },
        })
      }

      req.organization = { id: organizationId, role: 'unknown' }
      next()
    } catch (error) {
      console.error('Organization permission error:', error)
      return res.status(500).json({
        error: 'Organization permission check failed',
        code: 'ORG_PERMISSION_ERROR',
      })
    }
  }
}

/**
 * App-specific permission middleware
 */
export function requireAppPermission(
  action: 'create' | 'read' | 'update' | 'delete' | 'install' | 'uninstall'
) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        })
      }

      const appId = req.params.appId || req.params.id
      const organizationId =
        req.params.organizationId || req.user.organizationId

      if (!appId) {
        return res.status(400).json({
          error: 'App ID required',
          code: 'APP_ID_REQUIRED',
        })
      }

      if (!organizationId) {
        return res.status(400).json({
          error: 'Organization context required',
          code: 'ORG_CONTEXT_REQUIRED',
        })
      }

      const hasPermission = await checkAppPermission(
        req.user.id,
        action,
        appId,
        organizationId
      )

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Insufficient app permissions',
          code: 'APP_PERMISSION_DENIED',
          required: { action, appId, organizationId },
        })
      }

      req.organization = { id: organizationId, role: 'unknown' }
      next()
    } catch (error) {
      console.error('App permission error:', error)
      return res.status(500).json({
        error: 'App permission check failed',
        code: 'APP_PERMISSION_ERROR',
      })
    }
  }
}

/**
 * User management permission middleware
 */
export function requireUserManagementPermission(
  action: 'invite' | 'remove' | 'update_role' | 'view_members'
) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        })
      }

      const organizationId =
        req.params.organizationId || req.user.organizationId
      if (!organizationId) {
        return res.status(400).json({
          error: 'Organization context required',
          code: 'ORG_CONTEXT_REQUIRED',
        })
      }

      const targetUserId = req.params.userId || req.body.userId
      const hasPermission = await checkUserManagementPermission(
        req.user.id,
        action,
        organizationId,
        targetUserId
      )

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Insufficient user management permissions',
          code: 'USER_MGMT_PERMISSION_DENIED',
          required: { action, organizationId, targetUserId },
        })
      }

      req.organization = { id: organizationId, role: 'unknown' }
      next()
    } catch (error) {
      console.error('User management permission error:', error)
      return res.status(500).json({
        error: 'User management permission check failed',
        code: 'USER_MGMT_PERMISSION_ERROR',
      })
    }
  }
}

/**
 * Role-based access control middleware
 */
export function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      })
    }

    const userRoles = req.user.roles || []
    const hasRequiredRole = allowedRoles.some(role => userRoles.includes(role))

    if (!hasRequiredRole) {
      return res.status(403).json({
        error: 'Insufficient role permissions',
        code: 'ROLE_PERMISSION_DENIED',
        required: { roles: allowedRoles },
        current: { roles: userRoles },
      })
    }

    next()
  }
}

/**
 * Owner-only access middleware
 */
export function requireOwnership(
  getResourceOwnerId: (req: AuthenticatedRequest) => Promise<string | null>
) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        })
      }

      const ownerId = await getResourceOwnerId(req)
      if (!ownerId) {
        return res.status(404).json({
          error: 'Resource not found',
          code: 'RESOURCE_NOT_FOUND',
        })
      }

      if (ownerId !== req.user.id) {
        return res.status(403).json({
          error: 'Resource access denied - ownership required',
          code: 'OWNERSHIP_REQUIRED',
        })
      }

      next()
    } catch (error) {
      console.error('Ownership check error:', error)
      return res.status(500).json({
        error: 'Ownership check failed',
        code: 'OWNERSHIP_CHECK_ERROR',
      })
    }
  }
}

/**
 * Conditional permission middleware - checks multiple conditions
 */
export function requireAnyPermission(permissions: PermissionConfig[]) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        })
      }

      // Check if user has any of the required permissions
      for (const config of permissions) {
        try {
          const tenant = config.getTenant
            ? config.getTenant(req)
            : req.params.organizationId
          if (!tenant && config.requireOrganizationContext) continue

          const resourceKey = config.getResourceKey
            ? config.getResourceKey(req)
            : undefined

          const hasPermission = await checkPermission({
            user: req.user.id,
            action: config.action,
            resource: {
              type: config.resource,
              tenant: tenant || '',
              key: resourceKey,
            },
          })

          if (hasPermission) {
            req.organization = tenant
              ? { id: tenant, role: 'unknown' }
              : undefined
            return next()
          }
        } catch (error) {
          console.error(
            `Permission check failed for ${config.resource}:${config.action}:`,
            error
          )
          continue
        }
      }

      // No permissions matched
      return res.status(403).json({
        error:
          'Insufficient permissions - none of the required permissions were found',
        code: 'NO_MATCHING_PERMISSIONS',
        required: permissions.map(p => ({
          action: p.action,
          resource: p.resource,
        })),
      })
    } catch (error) {
      console.error('Multi-permission check error:', error)
      return res.status(500).json({
        error: 'Permission check failed',
        code: 'PERMISSION_CHECK_ERROR',
      })
    }
  }
}

/**
 * Convenience middleware combinations
 */
export const PermissionMiddleware = {
  // Organization permissions
  canCreateOrganization: requireOrganizationPermission('create'),
  canReadOrganization: requireOrganizationPermission('read'),
  canUpdateOrganization: requireOrganizationPermission('update'),
  canDeleteOrganization: requireOrganizationPermission('delete'),
  canManageOrganization: requireOrganizationPermission('manage'),

  // App permissions
  canCreateApp: requireAppPermission('create'),
  canReadApp: requireAppPermission('read'),
  canUpdateApp: requireAppPermission('update'),
  canDeleteApp: requireAppPermission('delete'),
  canInstallApp: requireAppPermission('install'),
  canUninstallApp: requireAppPermission('uninstall'),

  // User management permissions
  canInviteUsers: requireUserManagementPermission('invite'),
  canRemoveUsers: requireUserManagementPermission('remove'),
  canUpdateUserRoles: requireUserManagementPermission('update_role'),
  canViewMembers: requireUserManagementPermission('view_members'),

  // Role-based permissions
  adminOnly: requireRole(['admin']),
  ownerOrAdmin: requireRole(['owner', 'admin']),
  memberOrAbove: requireRole(['owner', 'admin', 'member']),

  // Custom permission factory
  custom: requirePermission,
}
