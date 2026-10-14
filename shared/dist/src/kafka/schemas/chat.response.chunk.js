"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatResponseChunkSchemaV1 = void 0;
const zod_1 = require("zod");
exports.chatResponseChunkSchemaV1 = zod_1.z.object({
    userId: zod_1.z.string().min(1),
    conversationId: zod_1.z.string().min(1),
    messageId: zod_1.z.string().min(1),
    sequence: zod_1.z.number().int().nonnegative(),
    type: zod_1.z.enum(['start', 'delta', 'done', 'error']),
    delta: zod_1.z.string().optional(),
});
