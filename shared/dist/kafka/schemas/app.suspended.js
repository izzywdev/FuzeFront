"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appSuspendedSchemaV1 = void 0;
const zod_1 = require("zod");
/**
 * Emitted when an app transitions to `suspended` (hidden from the menu, retained).
 */
exports.appSuspendedSchemaV1 = zod_1.z.object({
    slug: zod_1.z.string(),
    organizationId: zod_1.z.string().uuid().nullable().optional(),
    actorUserId: zod_1.z.string().uuid().optional(),
    suspendedAt: zod_1.z.string().datetime(),
});
