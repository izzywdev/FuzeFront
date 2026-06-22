"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingSubscriptionChangedSchemaV1 = void 0;
const zod_1 = require("zod");
exports.billingSubscriptionChangedSchemaV1 = zod_1.z.object({
    entityId: zod_1.z.string().uuid(),
    entityType: zod_1.z.enum(['user', 'organization']),
    planTier: zod_1.z.string(),
    status: zod_1.z.string(),
    seatQuantity: zod_1.z.number().int().optional(),
    stripeSubscriptionId: zod_1.z.string(),
});
