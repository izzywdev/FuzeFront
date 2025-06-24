"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignRoleInPermit = assignRoleInPermit;
exports.unassignRoleInPermit = unassignRoleInPermit;
exports.getUserRoleAssignments = getUserRoleAssignments;
exports.getTenantRoleAssignments = getTenantRoleAssignments;
exports.userHasRole = userHasRole;
exports.assignOrganizationRole = assignOrganizationRole;
exports.updateOrganizationRole = updateOrganizationRole;
const permit_1 = __importDefault(require("../../config/permit"));
/**
 * Assigns a role to a user in an organization (tenant)
 */
async function assignRoleInPermit(assignment) {
    try {
        await permit_1.default.api.roleAssignments.assign(assignment);
        console.log(`Role ${assignment.role} assigned to user ${assignment.user} in tenant ${assignment.tenant}`);
        return true;
    }
    catch (error) {
        console.error(`Error assigning role ${assignment.role} to user ${assignment.user}:`, error);
        return false;
    }
}
/**
 * Unassigns a role from a user in an organization (tenant)
 */
async function unassignRoleInPermit(assignment) {
    try {
        await permit_1.default.api.roleAssignments.unassign(assignment);
        console.log(`Role ${assignment.role} unassigned from user ${assignment.user} in tenant ${assignment.tenant}`);
        return true;
    }
    catch (error) {
        console.error(`Error unassigning role ${assignment.role} from user ${assignment.user}:`, error);
        return false;
    }
}
/**
 * Lists all role assignments for a user
 */
async function getUserRoleAssignments(userId, tenantId) {
    try {
        const filter = tenantId
            ? { user: userId, tenant: tenantId }
            : { user: userId };
        const assignments = await permit_1.default.api.roleAssignments.list(filter);
        return assignments;
    }
    catch (error) {
        console.error(`Error getting role assignments for user ${userId}:`, error);
        return [];
    }
}
/**
 * Lists all role assignments in a tenant
 */
async function getTenantRoleAssignments(tenantId) {
    try {
        const assignments = await permit_1.default.api.roleAssignments.list({
            tenant: tenantId,
        });
        return assignments;
    }
    catch (error) {
        console.error(`Error getting role assignments for tenant ${tenantId}:`, error);
        return [];
    }
}
/**
 * Checks if a user has a specific role in a tenant
 */
async function userHasRole(userId, role, tenantId) {
    try {
        const assignments = await getUserRoleAssignments(userId, tenantId);
        return assignments.some((assignment) => assignment.role === role && assignment.tenant === tenantId);
    }
    catch (error) {
        console.error(`Error checking if user ${userId} has role ${role}:`, error);
        return false;
    }
}
/**
 * Assigns organization membership roles based on membership role
 */
async function assignOrganizationRole(userId, organizationId, membershipRole) {
    try {
        // Map membership roles to Permit roles
        const roleMapping = {
            owner: 'admin', // Organization owners get admin permissions
            admin: 'admin', // Admins get admin permissions
            member: 'editor', // Members get editor permissions
            viewer: 'viewer', // Viewers get view-only permissions
        };
        const permitRole = roleMapping[membershipRole] || 'viewer';
        return await assignRoleInPermit({
            user: userId,
            role: permitRole,
            tenant: organizationId,
        });
    }
    catch (error) {
        console.error(`Error assigning organization role for user ${userId}:`, error);
        return false;
    }
}
/**
 * Updates user role when membership role changes
 */
async function updateOrganizationRole(userId, organizationId, oldRole, newRole) {
    try {
        // First unassign the old role
        const roleMapping = {
            owner: 'admin',
            admin: 'admin',
            member: 'editor',
            viewer: 'viewer',
        };
        const oldPermitRole = roleMapping[oldRole] || 'viewer';
        const newPermitRole = roleMapping[newRole] || 'viewer';
        if (oldPermitRole !== newPermitRole) {
            await unassignRoleInPermit({
                user: userId,
                role: oldPermitRole,
                tenant: organizationId,
            });
            await assignRoleInPermit({
                user: userId,
                role: newPermitRole,
                tenant: organizationId,
            });
        }
        return true;
    }
    catch (error) {
        console.error(`Error updating organization role for user ${userId}:`, error);
        return false;
    }
}
//# sourceMappingURL=role-assignment.js.map