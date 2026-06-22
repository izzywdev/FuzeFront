"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyEmailRequestedSchemaV1 = exports.SUPPORTED_TEMPLATES = void 0;
const zod_1 = require("zod");
exports.SUPPORTED_TEMPLATES = ['welcome', 'org-invite', 'membership-change'];
exports.notifyEmailRequestedSchemaV1 = zod_1.z.object({
    to: zod_1.z.string().email(),
    template: zod_1.z.enum(exports.SUPPORTED_TEMPLATES),
    vars: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
    orgId: zod_1.z.string().optional(),
    correlationId: zod_1.z.string(),
});
