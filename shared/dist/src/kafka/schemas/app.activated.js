"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appActivatedSchemaV1 = void 0;
const zod_1 = require("zod");
/**
 * Emitted when an app transitions to `activated` (becomes visible in the menu).
 */
exports.appActivatedSchemaV1 = zod_1.z.object({
    slug: zod_1.z.string(),
    organizationId: zod_1.z.string().uuid().nullable().optional(),
    /** Platform user id that performed the activation */
    actorUserId: zod_1.z.string().uuid().optional(),
    activatedAt: zod_1.z.string().datetime(),
});
