"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAlreadyExistsError = isAlreadyExistsError;
exports.createTenantInPermit = createTenantInPermit;
exports.updateTenantInPermit = updateTenantInPermit;
exports.deleteTenantFromPermit = deleteTenantFromPermit;
exports.getTenantFromPermit = getTenantFromPermit;
exports.listTenantsFromPermit = listTenantsFromPermit;
const permit_1 = __importDefault(require("../../config/permit"));
/**
 * Returns true when `error` is a benign "already exists" conflict (HTTP 409 /
 * duplicate / already exists) rather than a real failure. Permit's SDK surfaces
 * the upstream status in a few different shapes depending on version, so we
 * probe all of them plus the message text.
 */
function isAlreadyExistsError(error) {
    if (!error)
        return false;
    const status = error.status ??
        error.statusCode ??
        error.response?.status ??
        error.originalError?.response?.status;
    if (status === 409)
        return true;
    const message = String(error.message ?? error.response?.data?.message ?? '').toLowerCase();
    return (message.includes('409') ||
        message.includes('already exists') ||
        message.includes('duplicate') ||
        message.includes('conflict'));
}
/**
 * Creates a tenant in Permit.io for an organization.
 *
 * Idempotent: a 409 / "already exists" from a prior run is treated as success
 * so reconciliation can be re-run safely. Any other error is rethrown so the
 * caller records the step as `failed` (with `last_error`) and retries later.
 */
async function createTenantInPermit(organization) {
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
    try {
        await permit_1.default.api.tenants.create(tenant);
        console.log(`Tenant ${organization.id} created in Permit.io successfully`);
        return true;
    }
    catch (error) {
        if (isAlreadyExistsError(error)) {
            console.log(`Tenant ${organization.id} already exists in Permit.io (benign 409)`);
            return true;
        }
        console.error(`Error creating tenant ${organization.id} in Permit.io:`, error);
        throw error;
    }
}
/**
 * Updates a tenant in Permit.io
 */
async function updateTenantInPermit(organizationId, updates) {
    try {
        await permit_1.default.api.tenants.update(organizationId, updates);
        console.log(`Tenant ${organizationId} updated in Permit.io successfully`);
        return true;
    }
    catch (error) {
        console.error(`Error updating tenant ${organizationId} in Permit.io:`, error);
        return false;
    }
}
/**
 * Deletes a tenant from Permit.io
 */
async function deleteTenantFromPermit(organizationId) {
    try {
        await permit_1.default.api.tenants.delete(organizationId);
        console.log(`Tenant ${organizationId} deleted from Permit.io successfully`);
        return true;
    }
    catch (error) {
        console.error(`Error deleting tenant ${organizationId} from Permit.io:`, error);
        return false;
    }
}
/**
 * Gets tenant data from Permit.io
 */
async function getTenantFromPermit(organizationId) {
    try {
        const tenant = await permit_1.default.api.tenants.get(organizationId);
        return tenant;
    }
    catch (error) {
        console.error(`Error getting tenant ${organizationId} from Permit.io:`, error);
        return null;
    }
}
/**
 * Lists all tenants in Permit.io
 */
async function listTenantsFromPermit() {
    try {
        const tenants = await permit_1.default.api.tenants.list();
        return tenants;
    }
    catch (error) {
        console.error('Error listing tenants from Permit.io:', error);
        return [];
    }
}
//# sourceMappingURL=tenant-management.js.map