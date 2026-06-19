"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bulkSyncUsers = bulkSyncUsers;
exports.bulkSyncTenants = bulkSyncTenants;
exports.bulkAssignRoles = bulkAssignRoles;
exports.setupOrganizationWithRoles = setupOrganizationWithRoles;
exports.initialDataSync = initialDataSync;
const permit_1 = __importDefault(require("../../config/permit"));
/**
 * Bulk sync users to Permit.io
 */
async function bulkSyncUsers(users) {
    const results = { success: 0, failed: 0 };
    try {
        const permitUsers = users.map(user => ({
            key: user.id,
            email: user.email,
            first_name: user.firstName ||
                user.username?.split(' ')[0] ||
                user.email.split('@')[0],
            last_name: user.lastName || user.username?.split(' ').slice(1).join(' ') || '',
            attributes: {
                created_at: user.created_at,
                updated_at: user.updated_at,
                roles: user.roles,
            },
        }));
        // Process in batches to avoid overwhelming the API
        const batchSize = 10;
        for (let i = 0; i < permitUsers.length; i += batchSize) {
            const batch = permitUsers.slice(i, i + batchSize);
            const promises = batch.map(async (permitUser) => {
                try {
                    await permit_1.default.api.users.sync(permitUser);
                    results.success++;
                }
                catch (error) {
                    console.error(`Failed to sync user ${permitUser.key}:`, error);
                    results.failed++;
                }
            });
            await Promise.all(promises);
        }
        console.log(`Bulk user sync completed: ${results.success} successful, ${results.failed} failed`);
    }
    catch (error) {
        console.error('Error in bulk user sync:', error);
    }
    return results;
}
/**
 * Bulk sync organizations as tenants to Permit.io
 */
async function bulkSyncTenants(organizations) {
    const results = { success: 0, failed: 0 };
    try {
        const permitTenants = organizations.map(org => ({
            key: org.id,
            name: org.name,
            description: `Organization: ${org.name} (${org.type})`,
            attributes: {
                slug: org.slug,
                type: org.type,
                parent_id: org.parent_id,
                owner_id: org.owner_id,
                settings: org.settings,
                metadata: org.metadata,
                is_active: org.is_active,
                created_at: org.created_at,
                updated_at: org.updated_at,
            },
        }));
        // Process in batches
        const batchSize = 10;
        for (let i = 0; i < permitTenants.length; i += batchSize) {
            const batch = permitTenants.slice(i, i + batchSize);
            const promises = batch.map(async (tenant) => {
                try {
                    await permit_1.default.api.tenants.create(tenant);
                    results.success++;
                }
                catch (error) {
                    console.error(`Failed to sync tenant ${tenant.key}:`, error);
                    results.failed++;
                }
            });
            await Promise.all(promises);
        }
        console.log(`Bulk tenant sync completed: ${results.success} successful, ${results.failed} failed`);
    }
    catch (error) {
        console.error('Error in bulk tenant sync:', error);
    }
    return results;
}
/**
 * Bulk assign roles to users
 */
async function bulkAssignRoles(assignments) {
    const results = { success: 0, failed: 0 };
    try {
        // Process in batches
        const batchSize = 10;
        for (let i = 0; i < assignments.length; i += batchSize) {
            const batch = assignments.slice(i, i + batchSize);
            const promises = batch.map(async (assignment) => {
                try {
                    await permit_1.default.api.roleAssignments.assign(assignment);
                    results.success++;
                }
                catch (error) {
                    console.error(`Failed to assign role ${assignment.role} to user ${assignment.user}:`, error);
                    results.failed++;
                }
            });
            await Promise.all(promises);
        }
        console.log(`Bulk role assignment completed: ${results.success} successful, ${results.failed} failed`);
    }
    catch (error) {
        console.error('Error in bulk role assignment:', error);
    }
    return results;
}
/**
 * Complete organization setup with user roles
 */
async function setupOrganizationWithRoles(organization, membershipData) {
    try {
        // 1. Create tenant
        const tenant = {
            key: organization.id,
            name: organization.name,
            description: `Organization: ${organization.name} (${organization.type})`,
            attributes: {
                slug: organization.slug,
                type: organization.type,
                parent_id: organization.parent_id,
                owner_id: organization.owner_id,
                settings: organization.settings,
                metadata: organization.metadata,
                is_active: organization.is_active,
                created_at: organization.created_at,
                updated_at: organization.updated_at,
            },
        };
        await permit_1.default.api.tenants.create(tenant);
        // 2. Assign roles to members
        const roleMapping = {
            owner: 'admin',
            admin: 'admin',
            member: 'editor',
            viewer: 'viewer',
        };
        const roleAssignments = membershipData.map(membership => ({
            user: membership.userId,
            role: roleMapping[membership.role] || 'viewer',
            tenant: organization.id,
        }));
        await bulkAssignRoles(roleAssignments);
        console.log(`Organization ${organization.id} setup completed with ${membershipData.length} members`);
        return true;
    }
    catch (error) {
        console.error(`Error setting up organization ${organization.id}:`, error);
        return false;
    }
}
/**
 * Sync all existing data to Permit.io (for initial setup)
 */
async function initialDataSync(data) {
    console.log('Starting initial data sync to Permit.io...');
    // 1. Sync users first
    const userResults = await bulkSyncUsers(data.users);
    // 2. Sync organizations as tenants
    const tenantResults = await bulkSyncTenants(data.organizations);
    // 3. Setup role assignments
    const roleMapping = {
        owner: 'admin',
        admin: 'admin',
        member: 'editor',
        viewer: 'viewer',
    };
    const roleAssignments = data.memberships.map(membership => ({
        user: membership.userId,
        role: roleMapping[membership.role] || 'viewer',
        tenant: membership.organizationId,
    }));
    const roleResults = await bulkAssignRoles(roleAssignments);
    console.log('Initial data sync completed');
    return {
        users: userResults,
        tenants: tenantResults,
        roles: roleResults,
    };
}
//# sourceMappingURL=bulk-operations.js.map