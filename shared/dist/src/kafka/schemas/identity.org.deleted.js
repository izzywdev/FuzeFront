"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityOrgDeletedSchemaV1 = void 0;
const zod_1 = require("zod");
/**
 * Emitted when an organization is deleted. Thin payload: consumers tear their
 * own per-org state down from the id. `cascade` distinguishes a soft delete
 * (deactivation — `organizations.is_active = false`, the current behaviour) from
 * a hard delete (row removed); consumers deactivate vs. purge accordingly.
 */
exports.identityOrgDeletedSchemaV1 = zod_1.z.object({
    organizationId: zod_1.z.string().uuid(),
    slug: zod_1.z.string(),
    ownerId: zod_1.z.string().uuid().nullable(),
    cascade: zod_1.z.enum(['soft', 'hard']),
});
