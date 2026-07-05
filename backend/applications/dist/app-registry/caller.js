"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMemberOrgIds = getMemberOrgIds;
exports.getRolesInOrg = getRolesInOrg;
exports.resolveCaller = resolveCaller;
// Resolves the BOLA-safe caller context from the authenticated user. Mirrors the
// host backend's getMemberOrgIds + platform-admin convention
// (backend/src/routes/apps.ts): a caller's org scope is their ACTIVE
// organization_memberships; platform admin is the `admin` platform role.
const database_1 = require("../config/database");
/** Active org ids the caller belongs to. */
async function getMemberOrgIds(userId) {
    const rows = await (0, database_1.db)('organization_memberships')
        .where('user_id', userId)
        .where('status', 'active')
        .select('organization_id');
    return rows.map((r) => r.organization_id).filter(Boolean);
}
/** Roles (owner/admin/member/…) the caller holds in a specific org. */
async function getRolesInOrg(userId, organizationId) {
    const rows = await (0, database_1.db)('organization_memberships')
        .where('user_id', userId)
        .where('organization_id', organizationId)
        .where('status', 'active')
        .select('role');
    return rows.map((r) => r.role).filter(Boolean);
}
async function resolveCaller(user) {
    const roles = user.roles || [];
    const organizationIds = await getMemberOrgIds(user.id);
    return {
        userId: user.id,
        organizationIds,
        roles,
        isPlatformAdmin: roles.includes('admin'),
    };
}
//# sourceMappingURL=caller.js.map