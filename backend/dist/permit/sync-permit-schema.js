"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRODUCT_NS_SEP = exports.ProductPolicyError = exports.validateProductPolicy = exports.namespaceKey = exports.buildEnvSchema = exports.namespaceProductPolicy = exports.mergeProductPolicy = exports.permitSchema = void 0;
exports.syncPermitSchema = syncPermitSchema;
exports.syncPermitSchemaWithProducts = syncPermitSchemaWithProducts;
const schema_1 = require("./schema");
const product_policy_1 = require("./product-policy");
var schema_2 = require("./schema");
Object.defineProperty(exports, "permitSchema", { enumerable: true, get: function () { return schema_2.permitSchema; } });
var product_policy_2 = require("./product-policy");
Object.defineProperty(exports, "mergeProductPolicy", { enumerable: true, get: function () { return product_policy_2.mergeProductPolicy; } });
Object.defineProperty(exports, "namespaceProductPolicy", { enumerable: true, get: function () { return product_policy_2.namespaceProductPolicy; } });
Object.defineProperty(exports, "buildEnvSchema", { enumerable: true, get: function () { return product_policy_2.buildEnvSchema; } });
Object.defineProperty(exports, "namespaceKey", { enumerable: true, get: function () { return product_policy_2.namespaceKey; } });
Object.defineProperty(exports, "validateProductPolicy", { enumerable: true, get: function () { return product_policy_2.validateProductPolicy; } });
Object.defineProperty(exports, "ProductPolicyError", { enumerable: true, get: function () { return product_policy_2.ProductPolicyError; } });
Object.defineProperty(exports, "PRODUCT_NS_SEP", { enumerable: true, get: function () { return product_policy_2.PRODUCT_NS_SEP; } });
// The resource payload we send to Permit on update — name + actions plus the
// optional ReBAC bits (relations between resources, resource-instance-scoped
// roles with derivation). Only included when the resource declares them, so
// existing flat resources are sent unchanged.
function resourceUpdatePayload(resource) {
    const payload = {
        name: resource.name,
        actions: resource.actions,
    };
    if (resource.relations)
        payload.relations = resource.relations;
    if (resource.roles)
        payload.roles = resource.roles;
    return payload;
}
// get-or-(create|update): idempotent and agnostic to SDK error shapes.
async function syncPermitSchema(permit, schema = schema_1.permitSchema, log = console.log) {
    for (const resource of schema.resources) {
        try {
            await permit.api.resources.get(resource.key);
            await permit.api.resources.update(resource.key, resourceUpdatePayload(resource));
            log(`Permit resource updated: ${resource.key}`);
        }
        catch {
            await permit.api.resources.create(resource);
            log(`Permit resource created: ${resource.key}`);
        }
    }
    for (const role of schema.roles) {
        try {
            await permit.api.roles.get(role.key);
            await permit.api.roles.update(role.key, {
                name: role.name,
                permissions: role.permissions,
            });
            log(`Permit role updated: ${role.key}`);
        }
        catch {
            await permit.api.roles.create(role);
            log(`Permit role created: ${role.key}`);
        }
    }
}
// Sync the platform base schema MERGED with the given consumer product policies.
// This is the entrypoint a product-onboarding job calls after a product submits
// its policy. Each product's resources/actions/roles are namespaced (fuzemarket.*)
// before the merge, so re-running for one product never disturbs another.
async function syncPermitSchemaWithProducts(permit, products, log = console.log) {
    const merged = (0, product_policy_1.buildEnvSchema)(...products);
    await syncPermitSchema(permit, merged, log);
}
// CLI entry — only runs when executed directly (node dist/permit/sync-permit-schema.js).
// Lazily importing the real client here keeps the module import-safe for tests.
if (require.main === module) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const permit = require('../config/permit').default;
    syncPermitSchema(permit)
        .then(() => {
        console.log('Permit schema sync complete');
        process.exit(0);
    })
        .catch(err => {
        console.error('Permit schema sync failed:', err);
        process.exit(1);
    });
}
//# sourceMappingURL=sync-permit-schema.js.map