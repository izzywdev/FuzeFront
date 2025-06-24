import { Request, Response, NextFunction } from 'express';
export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email: string;
        roles: string[];
        organizationId?: string;
    };
    organization?: {
        id: string;
        role: string;
    };
}
export interface PermissionConfig {
    resource: string;
    action: string;
    getTenant?: (req: AuthenticatedRequest) => string;
    getResourceKey?: (req: AuthenticatedRequest) => string | undefined;
    fallbackToPublic?: boolean;
    requireOrganizationContext?: boolean;
}
/**
 * Generic permission middleware factory
 */
export declare function requirePermission(config: PermissionConfig): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void | Response<any, Record<string, any>>>;
/**
 * Organization-specific permission middleware
 */
export declare function requireOrganizationPermission(action: 'create' | 'read' | 'update' | 'delete' | 'manage'): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
/**
 * App-specific permission middleware
 */
export declare function requireAppPermission(action: 'create' | 'read' | 'update' | 'delete' | 'install' | 'uninstall'): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
/**
 * User management permission middleware
 */
export declare function requireUserManagementPermission(action: 'invite' | 'remove' | 'update_role' | 'view_members'): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
/**
 * Role-based access control middleware
 */
export declare function requireRole(allowedRoles: string[]): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>>;
/**
 * Owner-only access middleware
 */
export declare function requireOwnership(getResourceOwnerId: (req: AuthenticatedRequest) => Promise<string | null>): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
/**
 * Conditional permission middleware - checks multiple conditions
 */
export declare function requireAnyPermission(permissions: PermissionConfig[]): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void | Response<any, Record<string, any>>>;
/**
 * Convenience middleware combinations
 */
export declare const PermissionMiddleware: {
    canCreateOrganization: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canReadOrganization: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canUpdateOrganization: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canDeleteOrganization: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canManageOrganization: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canCreateApp: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canReadApp: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canUpdateApp: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canDeleteApp: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canInstallApp: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canUninstallApp: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canInviteUsers: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canRemoveUsers: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canUpdateUserRoles: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    canViewMembers: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
    adminOnly: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>>;
    ownerOrAdmin: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>>;
    memberOrAbove: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>>;
    custom: typeof requirePermission;
};
//# sourceMappingURL=permissions.d.ts.map