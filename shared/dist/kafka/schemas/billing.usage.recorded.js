"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingUsageRecordedSchemaV1 = void 0;
const zod_1 = require("zod");
exports.billingUsageRecordedSchemaV1 = zod_1.z.object({
    entityId: zod_1.z.string().uuid(),
    entityType: zod_1.z.enum(['user', 'organization']),
    meterEventName: zod_1.z.string(),
    quantity: zod_1.z.number().int().positive(),
    occurredAt: zod_1.z.string().datetime(),
});
