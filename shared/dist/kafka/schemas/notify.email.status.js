"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyEmailStatusSchemaV1 = void 0;
const zod_1 = require("zod");
exports.notifyEmailStatusSchemaV1 = zod_1.z.object({
    correlationId: zod_1.z.string(),
    to: zod_1.z.string().email(),
    template: zod_1.z.string(),
    status: zod_1.z.enum(['sent', 'failed', 'dead-lettered']),
    error: zod_1.z.string().optional(),
    providerMessageId: zod_1.z.string().optional(),
    attemptedAt: zod_1.z.string(), // ISO-8601
});
