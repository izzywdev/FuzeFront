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
    params: Record<string, string>;
    body: any;
    query: any;
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
export declare function requirePermission(config: PermissionConfig): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
/**
 * Organization-specific permission middleware
 */
export declare function requireOrganizationPermission(action: 'create' | 'read' | 'update' | 'delete' | 'manage'): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
/**
 * App-specific permission middleware
 */
export declare function requireAppPermission(action: 'create' | 'read' | 'update' | 'delete' | 'install' | 'uninstall'): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
/**
 * User management permission middleware
 */
export declare function requireUserManagementPermission(action: 'invite' | 'remove' | 'update_role' | 'view_members'): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
/**
 * Role-based access control middleware
 */
export declare function requireRole(allowedRoles: string[]): (req: AuthenticatedRequest, res: Response, next: NextFunction) => any;
/**
 * Owner-only access middleware
 */
export declare function requireOwnership(getResourceOwnerId: (req: AuthenticatedRequest) => Promise<string | null>): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
/**
 * Conditional permission middleware - checks multiple conditions
 */
export declare function requireAnyPermission(permissions: PermissionConfig[]): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
/**
 * Convenience middleware combinations
 */
export declare const PermissionMiddleware: {
    canCreateOrganization: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canReadOrganization: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canUpdateOrganization: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canDeleteOrganization: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canManageOrganization: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canCreateApp: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canReadApp: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canUpdateApp: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canDeleteApp: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canInstallApp: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canUninstallApp: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canInviteUsers: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canRemoveUsers: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canUpdateUserRoles: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    canViewMembers: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<any>;
    adminOnly: (req: AuthenticatedRequest, res: Response, next: NextFunction) => any;
    ownerOrAdmin: (req: AuthenticatedRequest, res: Response, next: NextFunction) => any;
    memberOrAbove: (req: AuthenticatedRequest, res: Response, next: NextFunction) => any;
    custom: typeof requirePermission;
};
//# sourceMappingURL=permissions.d.ts.map