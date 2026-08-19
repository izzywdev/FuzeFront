"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.permitSchema = void 0;
exports.syncPermitSchema = syncPermitSchema;
const schema_1 = require("./schema");
var schema_2 = require("./schema");
Object.defineProperty(exports, "permitSchema", { enumerable: true, get: function () { return schema_2.permitSchema; } });
// get-or-(create|update): idempotent and agnostic to SDK error shapes.
async function syncPermitSchema(permit, schema = schema_1.permitSchema, log = console.log) {
    for (const resource of schema.resources) {
        try {
            await permit.api.resources.get(resource.key);
            await permit.api.resources.update(resource.key, {
                name: resource.name,
                actions: resource.actions,
            });
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