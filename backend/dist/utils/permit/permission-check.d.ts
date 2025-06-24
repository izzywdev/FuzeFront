export interface PermissionCheck {
    user: string;
    action: string;
    resource: {
        type: string;
        tenant: string;
        key?: string;
    };
    context?: Record<string, any>;
}
/**
 * Checks if a user has permission to perform an action on a resource
 */
export declare function checkPermission(check: PermissionCheck): Promise<boolean>;
/**
 * Performs bulk permission checks for multiple resources
 */
export declare function bulkCheckPermissions(checks: PermissionCheck[]): Promise<boolean[]>;
/**
 * Checks organization-level permissions
 */
export declare function checkOrganizationPermission(userId: string, action: 'create' | 'read' | 'update' | 'delete' | 'manage', organizationId: string, context?: Record<string, any>): Promise<boolean>;
/**
 * Checks app-level permissions within an organization
 */
export declare function checkAppPermission(userId: string, action: 'create' | 'read' | 'update' | 'delete' | 'install' | 'uninstall', appId: string, organizationId: string, context?: Record<string, any>): Promise<boolean>;
/**
 * Checks user management permissions within an organization
 */
export declare function checkUserManagementPermission(userId: string, action: 'invite' | 'remove' | 'update_role' | 'view_members', organizationId: string, targetUserId?: string): Promise<boolean>;
/**
 * Checks if user can access organization context
 */
export declare function checkOrganizationAccess(userId: string, organizationId: string): Promise<boolean>;
/**
 * Gets all permissions for a user in an organization
 */
export declare function getUserPermissions(userId: string, organizationId: string): Promise<import("permitio/build/main/enforcement/interfaces").IUserPermissions>;
/**
 * Middleware helper to check permissions in Express routes
 */
export declare function requirePermission(action: string, resourceType: string, getTenant: (req: any) => string, getResourceKey?: (req: any) => string): (req: any, res: any, next: any) => Promise<any>;
//# sourceMappingURL=permission-check.d.ts.map