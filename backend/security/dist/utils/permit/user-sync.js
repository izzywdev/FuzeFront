"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncUserToPermit = syncUserToPermit;
exports.deleteUserFromPermit = deleteUserFromPermit;
exports.getUserFromPermit = getUserFromPermit;
exports.syncServiceTokenToPermit = syncServiceTokenToPermit;
exports.removeServiceTokenFromPermit = removeServiceTokenFromPermit;
exports.updateUserInPermit = updateUserInPermit;
const permit_1 = __importDefault(require("../../config/permit"));
const role_assignment_1 = require("./role-assignment");
/**
 * Syncs a user to Permit.io
 */
async function syncUserToPermit(user) {
    try {
        const permitUser = {
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
        };
        await permit_1.default.api.users.sync(permitUser);
        console.log(`User ${user.id} synced to Permit.io successfully`);
        return true;
    }
    catch (error) {
        console.error(`Error syncing user ${user.id} to Permit.io:`, error);
        return false;
    }
}
/**
 * Deletes a user from Permit.io
 */
async function deleteUserFromPermit(userId) {
    try {
        await permit_1.default.api.users.delete(userId);
        console.log(`User ${userId} deleted from Permit.io successfully`);
        return true;
    }
    catch (error) {
        console.error(`Error deleting user ${userId} from Permit.io:`, error);
        return false;
    }
}
/**
 * Gets user data from Permit.io
 */
async function getUserFromPermit(userId) {
    try {
        const user = await permit_1.default.api.users.get(userId);
        return user;
    }
    catch (error) {
        console.error(`Error getting user ${userId} from Permit.io:`, error);
        return null;
    }
}
/**
 * Syncs a service/API token as a Permit principal and assigns it a role.
 * The Permit principal key is "svc_token:<tokenId>".
 */
async function syncServiceTokenToPermit(tokenId, orgId, permitRole) {
    try {
        await permit_1.default.api.users.sync({
            key: `svc_token:${tokenId}`,
            attributes: { is_service_token: true, org_id: orgId },
        });
        await (0, role_assignment_1.assignRoleInPermit)({
            user: `svc_token:${tokenId}`,
            role: permitRole,
            tenant: orgId,
        });
        console.log(`Service token ${tokenId} synced to Permit.io with role ${permitRole} in org ${orgId}`);
        return true;
    }
    catch (error) {
        console.error(`Error syncing service token ${tokenId} to Permit.io:`, error);
        return false;
    }
}
/**
 * Removes a service/API token role from Permit.
 * The Permit principal key is "svc_token:<tokenId>".
 */
async function removeServiceTokenFromPermit(tokenId, orgId, permitRole) {
    try {
        await (0, role_assignment_1.unassignRoleInPermit)({
            user: `svc_token:${tokenId}`,
            role: permitRole,
            tenant: orgId,
        });
        console.log(`Service token ${tokenId} removed from Permit.io (role ${permitRole}) in org ${orgId}`);
        return true;
    }
    catch (error) {
        console.error(`Error removing service token ${tokenId} from Permit.io:`, error);
        return false;
    }
}
/**
 * Updates user attributes in Permit.io
 */
async function updateUserInPermit(userId, updates) {
    try {
        await permit_1.default.api.users.update(userId, updates);
        console.log(`User ${userId} updated in Permit.io successfully`);
        return true;
    }
    catch (error) {
        console.error(`Error updating user ${userId} in Permit.io:`, error);
        return false;
    }
}
//# sourceMappingURL=user-sync.js.map