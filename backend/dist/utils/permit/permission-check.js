"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkPermission = checkPermission;
exports.bulkCheckPermissions = bulkCheckPermissions;
exports.checkOrganizationPermission = checkOrganizationPermission;
exports.checkAppPermission = checkAppPermission;
exports.checkUserManagementPermission = checkUserManagementPermission;
exports.checkOrganizationAccess = checkOrganizationAccess;
exports.getUserPermissions = getUserPermissions;
exports.requirePermission = requirePermission;
const permit_1 = __importStar(require("../../config/permit"));
/**
 * Checks if a user has permission to perform an action on a resource
 */
async function checkPermission(check) {
    // In CI/no-op mode the Permit SDK is a proxy that resolves every call to
    // undefined — there is no live PDP. Grant everything so the E2E setup can
    // register apps and run the sign-in flow without a real Permit deployment.
    // This path is only reachable when PERMIT_API_KEY is one of the CI dummy
    // values (e.g. "ci-noop") — never in production.
    if (permit_1.isNoOpMode)
        return true;
    try {
        const result = await permit_1.default.check(check.user, check.action, check.resource, check.context);
        console.log(`Permission check - User: ${check.user}, Action: ${check.action}, Resource: ${check.resource.type}, Result: ${result}`);
        return result;
    }
    catch (error) {
        console.error('Error checking permission:', error);
        return false; // Fail safe - deny access on error
    }
}
/**
 * Performs bulk permission checks for multiple resources
 */
async function bulkCheckPermissions(checks) {
    // No-op CI mode: grant everything (mirrors the single-check short-circuit above).
    if (permit_1.isNoOpMode)
        return new Array(checks.length).fill(true);
    try {
        const bulkChecks = checks.map(check => ({
            user: check.user,
            action: check.action,
            resource: check.resource,
            context: check.context,
        }));
        const results = await permit_1.default.bulkCheck(bulkChecks);
        console.log(`Bulk permission check completed for ${checks.length} checks`);
        return results;
    }
    catch (error) {
        console.error('Error in bulk permission check:', error);
        // Return all false for safety
        return new Array(checks.length).fill(false);
    }
}
/**
 * Checks organization-level permissions
 */
async function checkOrganizationPermission(userId, action, organizationId, context) {
    // Authoritative source is Permit.io. We deliberately do NOT fall back to a DB
    // membership check on a clean Permit deny — that would fail OPEN and let a
    // local membership row override an intentional Permit denial (auth bypass on a
    // money path). The correct fix for "owner wrongly denied" is to ensure
    // provisioning SYNCS the owner role into Permit (see ensurePersonalOrg /
    // reconcileOrganizationProvisioning in the security service), not to bypass it.
    return checkPermission({
        user: userId,
        action,
        resource: {
            type: 'Organization',
            tenant: organizationId,
        },
        context,
    });
}
/**
 * Checks app-level permissions within an organization
 */
async function checkAppPermission(userId, action, appId, organizationId, context) {
    return checkPermission({
        user: userId,
        action,
        resource: {
            type: 'App',
            tenant: organizationId,
            key: appId,
        },
        context,
    });
}
/**
 * Checks user management permissions within an organization
 */
async function checkUserManagementPermission(userId, action, organizationId, targetUserId) {
    return checkPermission({
        user: userId,
        action,
        resource: {
            type: 'UserManagement',
            tenant: organizationId,
        },
        context: targetUserId ? { target_user: targetUserId } : undefined,
    });
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
    });
}
/**
 * Gets all permissions for a user in an organization
 */
async function getUserPermissions(userId, organizationId) {
    try {
        const permissions = await permit_1.default.getUserPermissions(userId, [
            organizationId,
        ]);
        return permissions;
    }
    catch (error) {
        console.error(`Error getting user permissions for ${userId}:`, error);
        return {};
    }
}
/**
 * Middleware helper to check permissions in Express routes
 */
function requirePermission(action, resourceType, getTenant, getResourceKey) {
    return async (req, res, next) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            const tenant = getTenant(req);
            if (!tenant) {
                return res.status(400).json({ error: 'Organization context required' });
            }
            const resourceKey = getResourceKey ? getResourceKey(req) : undefined;
            const hasPermission = await checkPermission({
                user: req.user.id,
                action,
                resource: {
                    type: resourceType,
                    tenant,
                    key: resourceKey,
                },
            });
            if (!hasPermission) {
                return res.status(403).json({
                    error: 'Insufficient permissions',
                    required: { action, resource: resourceType, tenant },
                });
            }
            next();
        }
        catch (error) {
            console.error('Permission middleware error:', error);
            return res.status(500).json({ error: 'Permission check failed' });
        }
    };
}
//# sourceMappingURL=permission-check.js.map