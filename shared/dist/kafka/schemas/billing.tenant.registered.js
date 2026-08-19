"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingTenantRegisteredSchemaV1 = void 0;
const zod_1 = require("zod");
exports.billingTenantRegisteredSchemaV1 = zod_1.z.object({
    entityId: zod_1.z.string().uuid(),
    /** Always 'organization' — a new corporate tenant, not a personal account. */
    entityType: zod_1.z.literal('organization'),
    stripeCustomerId: zod_1.z.string(),
});
