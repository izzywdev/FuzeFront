import { Request, Response, NextFunction } from 'express'
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
export declare function requirePermission(
  config: PermissionConfig
): (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<void | Response<any, Record<string, any>>>
/**
 * Organization-specific permission middleware
 */
export declare function requireOrganizationPermission(
  action: 'create' | 'read' | 'update' | 'delete' | 'manage'
): (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<Response<any, Record<string, any>> | undefined>
/**
 * App-specific permission middleware
 */
export declare function requireAppPermission(
  action: 'create' | 'read' | 'update' | 'delete' | 'install' | 'uninstall'
): (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<Response<any, Record<string, any>> | undefined>
/**
 * User management permission middleware
 */
export declare function requireUserManagementPermission(
  action: 'invite' | 'remove' | 'update_role' | 'view_members'
): (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<Response<any, Record<string, any>> | undefined>
/**
 * Role-based access control middleware
 */
export declare function requireRole(
  allowedRoles: string[]
): (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Response<any, Record<string, any>> | undefined
/**
 * Owner-only access middleware
 */
export declare function requireOwnership(
  getResourceOwnerId: (req: AuthenticatedRequest) => Promise<string | null>
): (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<Response<any, Record<string, any>> | undefined>
/**
 * Conditional permission middleware - checks multiple conditions
 */
export declare function requireAnyPermission(
  permissions: PermissionConfig[]
): (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<void | Response<any, Record<string, any>>>
/**
 * Convenience middleware combinations
 */
export declare const PermissionMiddleware: {
  canCreateOrganization: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canReadOrganization: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canUpdateOrganization: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canDeleteOrganization: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canManageOrganization: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canCreateApp: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canReadApp: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canUpdateApp: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canDeleteApp: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canInstallApp: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canUninstallApp: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canInviteUsers: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canRemoveUsers: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canUpdateUserRoles: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  canViewMembers: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<Response<any, Record<string, any>> | undefined>
  adminOnly: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Response<any, Record<string, any>> | undefined
  ownerOrAdmin: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Response<any, Record<string, any>> | undefined
  memberOrAbove: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Response<any, Record<string, any>> | undefined
  custom: typeof requirePermission
}
//# sourceMappingURL=permissions.d.ts.map
