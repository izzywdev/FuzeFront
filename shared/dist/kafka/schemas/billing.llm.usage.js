"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingLlmUsageSchemaV1 = void 0;
const zod_1 = require("zod");
exports.billingLlmUsageSchemaV1 = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    orgId: zod_1.z.string().uuid(),
    model: zod_1.z.string(),
    promptTokens: zod_1.z.number().int().nonnegative(),
    completionTokens: zod_1.z.number().int().nonnegative(),
    totalTokens: zod_1.z.number().int().nonnegative(),
    conversationId: zod_1.z.string().uuid(),
    timestamp: zod_1.z.string().datetime(),
});
