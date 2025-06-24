"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionMiddleware = void 0;
exports.requirePermission = requirePermission;
exports.requireOrganizationPermission = requireOrganizationPermission;
exports.requireAppPermission = requireAppPermission;
exports.requireUserManagementPermission = requireUserManagementPermission;
exports.requireRole = requireRole;
exports.requireOwnership = requireOwnership;
exports.requireAnyPermission = requireAnyPermission;
const permission_check_1 = require("../utils/permit/permission-check");
/**
 * Generic permission middleware factory
 */
function requirePermission(config) {
    return async (req, res, next) => {
        try {
            // Check authentication
            if (!req.user?.id) {
                return res.status(401).json({
                    error: 'Authentication required',
                    code: 'AUTH_REQUIRED',
                });
            }
            // Get tenant (organization) context
            let tenant;
            if (config.getTenant) {
                tenant = config.getTenant(req);
            }
            else if (req.params.organizationId) {
                tenant = req.params.organizationId;
            }
            else if (req.user.organizationId) {
                tenant = req.user.organizationId;
            }
            else if (config.requireOrganizationContext) {
                return res.status(400).json({
                    error: 'Organization context required',
                    code: 'ORG_CONTEXT_REQUIRED',
                });
            }
            else {
                // No tenant context, skip permission check if fallback allowed
                if (config.fallbackToPublic) {
                    return next();
                }
                return res.status(400).json({
                    error: 'Organization context required',
                    code: 'ORG_CONTEXT_REQUIRED',
                });
            }
            // Get resource key if needed
            const resourceKey = config.getResourceKey
                ? config.getResourceKey(req)
                : undefined;
            // Check permission
            const hasPermission = await (0, permission_check_1.checkPermission)({
                user: req.user.id,
                action: config.action,
                resource: {
                    type: config.resource,
                    tenant,
                    key: resourceKey,
                },
            });
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
                });
            }
            // Add organization context to request for downstream handlers
            req.organization = { id: tenant, role: 'unknown' };
            next();
        }
        catch (error) {
            console.error('Permission middleware error:', error);
            return res.status(500).json({
                error: 'Permission check failed',
                code: 'PERMISSION_CHECK_ERROR',
            });
        }
    };
}
/**
 * Organization-specific permission middleware
 */
function requireOrganizationPermission(action) {
    return async (req, res, next) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({
                    error: 'Authentication required',
                    code: 'AUTH_REQUIRED',
                });
            }
            const organizationId = req.params.organizationId || req.params.id;
            if (!organizationId) {
                return res.status(400).json({
                    error: 'Organization ID required',
                    code: 'ORG_ID_REQUIRED',
                });
            }
            const hasPermission = await (0, permission_check_1.checkOrganizationPermission)(req.user.id, action, organizationId);
            if (!hasPermission) {
                return res.status(403).json({
                    error: 'Insufficient organization permissions',
                    code: 'ORG_PERMISSION_DENIED',
                    required: { action, organizationId },
                });
            }
            req.organization = { id: organizationId, role: 'unknown' };
            next();
        }
        catch (error) {
            console.error('Organization permission error:', error);
            return res.status(500).json({
                error: 'Organization permission check failed',
                code: 'ORG_PERMISSION_ERROR',
            });
        }
    };
}
/**
 * App-specific permission middleware
 */
function requireAppPermission(action) {
    return async (req, res, next) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({
                    error: 'Authentication required',
                    code: 'AUTH_REQUIRED',
                });
            }
            const appId = req.params.appId || req.params.id;
            const organizationId = req.params.organizationId || req.user.organizationId;
            if (!appId) {
                return res.status(400).json({
                    error: 'App ID required',
                    code: 'APP_ID_REQUIRED',
                });
            }
            if (!organizationId) {
                return res.status(400).json({
                    error: 'Organization context required',
                    code: 'ORG_CONTEXT_REQUIRED',
                });
            }
            const hasPermission = await (0, permission_check_1.checkAppPermission)(req.user.id, action, appId, organizationId);
            if (!hasPermission) {
                return res.status(403).json({
                    error: 'Insufficient app permissions',
                    code: 'APP_PERMISSION_DENIED',
                    required: { action, appId, organizationId },
                });
            }
            req.organization = { id: organizationId, role: 'unknown' };
            next();
        }
        catch (error) {
            console.error('App permission error:', error);
            return res.status(500).json({
                error: 'App permission check failed',
                code: 'APP_PERMISSION_ERROR',
            });
        }
    };
}
/**
 * User management permission middleware
 */
function requireUserManagementPermission(action) {
    return async (req, res, next) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({
                    error: 'Authentication required',
                    code: 'AUTH_REQUIRED',
                });
            }
            const organizationId = req.params.organizationId || req.user.organizationId;
            if (!organizationId) {
                return res.status(400).json({
                    error: 'Organization context required',
                    code: 'ORG_CONTEXT_REQUIRED',
                });
            }
            const targetUserId = req.params.userId || req.body.userId;
            const hasPermission = await (0, permission_check_1.checkUserManagementPermission)(req.user.id, action, organizationId, targetUserId);
            if (!hasPermission) {
                return res.status(403).json({
                    error: 'Insufficient user management permissions',
                    code: 'USER_MGMT_PERMISSION_DENIED',
                    required: { action, organizationId, targetUserId },
                });
            }
            req.organization = { id: organizationId, role: 'unknown' };
            next();
        }
        catch (error) {
            console.error('User management permission error:', error);
            return res.status(500).json({
                error: 'User management permission check failed',
                code: 'USER_MGMT_PERMISSION_ERROR',
            });
        }
    };
}
/**
 * Role-based access control middleware
 */
function requireRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.user?.id) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED',
            });
        }
        const userRoles = req.user.roles || [];
        const hasRequiredRole = allowedRoles.some(role => userRoles.includes(role));
        if (!hasRequiredRole) {
            return res.status(403).json({
                error: 'Insufficient role permissions',
                code: 'ROLE_PERMISSION_DENIED',
                required: { roles: allowedRoles },
                current: { roles: userRoles },
            });
        }
        next();
    };
}
/**
 * Owner-only access middleware
 */
function requireOwnership(getResourceOwnerId) {
    return async (req, res, next) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({
                    error: 'Authentication required',
                    code: 'AUTH_REQUIRED',
                });
            }
            const ownerId = await getResourceOwnerId(req);
            if (!ownerId) {
                return res.status(404).json({
                    error: 'Resource not found',
                    code: 'RESOURCE_NOT_FOUND',
                });
            }
            if (ownerId !== req.user.id) {
                return res.status(403).json({
                    error: 'Resource access denied - ownership required',
                    code: 'OWNERSHIP_REQUIRED',
                });
            }
            next();
        }
        catch (error) {
            console.error('Ownership check error:', error);
            return res.status(500).json({
                error: 'Ownership check failed',
                code: 'OWNERSHIP_CHECK_ERROR',
            });
        }
    };
}
/**
 * Conditional permission middleware - checks multiple conditions
 */
function requireAnyPermission(permissions) {
    return async (req, res, next) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({
                    error: 'Authentication required',
                    code: 'AUTH_REQUIRED',
                });
            }
            // Check if user has any of the required permissions
            for (const config of permissions) {
                try {
                    const tenant = config.getTenant
                        ? config.getTenant(req)
                        : req.params.organizationId;
                    if (!tenant && config.requireOrganizationContext)
                        continue;
                    const resourceKey = config.getResourceKey
                        ? config.getResourceKey(req)
                        : undefined;
                    const hasPermission = await (0, permission_check_1.checkPermission)({
                        user: req.user.id,
                        action: config.action,
                        resource: {
                            type: config.resource,
                            tenant: tenant || '',
                            key: resourceKey,
                        },
                    });
                    if (hasPermission) {
                        req.organization = tenant
                            ? { id: tenant, role: 'unknown' }
                            : undefined;
                        return next();
                    }
                }
                catch (error) {
                    console.error(`Permission check failed for ${config.resource}:${config.action}:`, error);
                    continue;
                }
            }
            // No permissions matched
            return res.status(403).json({
                error: 'Insufficient permissions - none of the required permissions were found',
                code: 'NO_MATCHING_PERMISSIONS',
                required: permissions.map(p => ({
                    action: p.action,
                    resource: p.resource,
                })),
            });
        }
        catch (error) {
            console.error('Multi-permission check error:', error);
            return res.status(500).json({
                error: 'Permission check failed',
                code: 'PERMISSION_CHECK_ERROR',
            });
        }
    };
}
/**
 * Convenience middleware combinations
 */
exports.PermissionMiddleware = {
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
};
//# sourceMappingURL=permissions.js.map