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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncExistingDataToPermit = syncExistingDataToPermit;
exports.syncSingleUserToPermit = syncSingleUserToPermit;
exports.syncSingleOrganizationToPermit = syncSingleOrganizationToPermit;
exports.checkPermitConnection = checkPermitConnection;
const database_1 = __importDefault(require("../../config/database"));
const bulk_operations_1 = require("./bulk-operations");
/**
 * Syncs all existing database data to Permit.io
 * This should be run once after Permit.io setup is complete
 */
async function syncExistingDataToPermit() {
    try {
        console.log('🚀 Starting data sync to Permit.io...');
        // 1. Fetch all users from database
        console.log('📥 Fetching users from database...');
        const usersFromDb = await (0, database_1.default)('users').select('*');
        const users = usersFromDb.map(user => ({
            id: user.id,
            email: user.email,
            firstName: user.first_name || '',
            lastName: user.last_name || '',
            roles: user.roles ? JSON.parse(user.roles) : [],
            username: user.username || user.email.split('@')[0],
            created_at: user.created_at,
            updated_at: user.updated_at,
        }));
        console.log(`Found ${users.length} users`);
        // 2. Fetch all organizations from database
        console.log('📥 Fetching organizations from database...');
        const orgsFromDb = await (0, database_1.default)('organizations')
            .select('*')
            .where('is_active', true);
        const organizations = orgsFromDb.map(org => ({
            id: org.id,
            name: org.name,
            slug: org.slug,
            parent_id: org.parent_id,
            owner_id: org.owner_id,
            type: org.type,
            settings: JSON.parse(org.settings || '{}'),
            metadata: JSON.parse(org.metadata || '{}'),
            is_active: org.is_active,
            created_at: org.created_at,
            updated_at: org.updated_at,
        }));
        console.log(`Found ${organizations.length} organizations`);
        // 3. Fetch all memberships from database
        console.log('📥 Fetching organization memberships from database...');
        const membershipsFromDb = await (0, database_1.default)('organization_memberships')
            .select('*')
            .where('status', 'active');
        const memberships = membershipsFromDb.map(membership => ({
            userId: membership.user_id,
            organizationId: membership.organization_id,
            role: membership.role,
        }));
        console.log(`Found ${memberships.length} active memberships`);
        // 4. Perform the sync
        const results = await (0, bulk_operations_1.initialDataSync)({
            users,
            organizations,
            memberships,
        });
        // 5. Report results
        console.log('\n✅ Data sync completed!');
        console.log('📊 Results:');
        console.log(`  Users: ${results.users.success} synced, ${results.users.failed} failed`);
        console.log(`  Tenants: ${results.tenants.success} synced, ${results.tenants.failed} failed`);
        console.log(`  Role Assignments: ${results.roles.success} synced, ${results.roles.failed} failed`);
        const totalSuccess = results.users.success + results.tenants.success + results.roles.success;
        const totalFailed = results.users.failed + results.tenants.failed + results.roles.failed;
        if (totalFailed === 0) {
            console.log('🎉 All data synced successfully!');
        }
        else {
            console.log(`⚠️  ${totalFailed} operations failed. Check logs above for details.`);
        }
    }
    catch (error) {
        console.error('❌ Error during data sync:', error);
        throw error;
    }
}
/**
 * Syncs a single user to Permit.io (useful for new registrations)
 */
async function syncSingleUserToPermit(userId) {
    try {
        console.log(`🔄 Syncing user ${userId} to Permit.io...`);
        // Fetch user data
        const userFromDb = await (0, database_1.default)('users').where('id', userId).first();
        if (!userFromDb) {
            console.error(`User ${userId} not found in database`);
            return false;
        }
        const user = {
            id: userFromDb.id,
            email: userFromDb.email,
            firstName: userFromDb.first_name || '',
            lastName: userFromDb.last_name || '',
            roles: userFromDb.roles ? JSON.parse(userFromDb.roles) : [],
            username: userFromDb.username || userFromDb.email.split('@')[0],
            created_at: userFromDb.created_at,
            updated_at: userFromDb.updated_at,
        };
        // Sync user
        const results = await (0, bulk_operations_1.bulkSyncUsers)([user]);
        if (results.success === 1) {
            console.log(`✅ User ${userId} synced successfully`);
            return true;
        }
        else {
            console.error(`❌ Failed to sync user ${userId}`);
            return false;
        }
    }
    catch (error) {
        console.error(`Error syncing user ${userId}:`, error);
        return false;
    }
}
/**
 * Syncs a single organization to Permit.io (useful for new organizations)
 */
async function syncSingleOrganizationToPermit(organizationId) {
    try {
        console.log(`🔄 Syncing organization ${organizationId} to Permit.io...`);
        // Fetch organization data
        const orgFromDb = await (0, database_1.default)('organizations')
            .where('id', organizationId)
            .first();
        if (!orgFromDb) {
            console.error(`Organization ${organizationId} not found in database`);
            return false;
        }
        const organization = {
            id: orgFromDb.id,
            name: orgFromDb.name,
            slug: orgFromDb.slug,
            parent_id: orgFromDb.parent_id,
            owner_id: orgFromDb.owner_id,
            type: orgFromDb.type,
            settings: JSON.parse(orgFromDb.settings || '{}'),
            metadata: JSON.parse(orgFromDb.metadata || '{}'),
            is_active: orgFromDb.is_active,
            created_at: orgFromDb.created_at,
            updated_at: orgFromDb.updated_at,
        };
        // Sync organization as tenant
        const results = await (0, bulk_operations_1.bulkSyncTenants)([organization]);
        if (results.success === 1) {
            console.log(`✅ Organization ${organizationId} synced successfully`);
            return true;
        }
        else {
            console.error(`❌ Failed to sync organization ${organizationId}`);
            return false;
        }
    }
    catch (error) {
        console.error(`Error syncing organization ${organizationId}:`, error);
        return false;
    }
}
/**
 * Health check for Permit.io connection
 */
async function checkPermitConnection() {
    try {
        const permit = (await Promise.resolve().then(() => __importStar(require('../../config/permit')))).default;
        // Try to list projects to test connection
        await permit.api.projects.list();
        console.log('✅ Permit.io connection successful');
        return true;
    }
    catch (error) {
        console.error('❌ Permit.io connection failed:', error);
        return false;
    }
}
//# sourceMappingURL=sync-existing-data.js.map