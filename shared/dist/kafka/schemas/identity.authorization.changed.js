"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityAuthorizationChangedSchemaV1 = void 0;
const zod_1 = require("zod");
exports.identityAuthorizationChangedSchemaV1 = zod_1.z.object({
    organizationId: zod_1.z.string().uuid(),
    subjectId: zod_1.z.string().uuid(),
    change: zod_1.z.enum(['membership_added', 'membership_removed', 'membership_role_changed']),
    role: zod_1.z.string().min(1).max(64).optional(),
});
