"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityAuthorizationChangedSchemaV1 = void 0;
const zod_1 = require("zod");
/**
 * A small, tenant-scoped authorization invalidation signal.
 *
 * It deliberately carries neither Permit/OPAL policy source nor a permission
 * set. Those are security-sensitive implementation details and consumers must
 * obtain an allowed subject's current grants through FuzeFront instead.  The
 * event's sole purpose is to let an authorized consumer invalidate materialized
 * access decisions after a membership/role change.
 */
exports.identityAuthorizationChangedSchemaV1 = zod_1.z.object({
    organizationId: zod_1.z.string().uuid(),
    subjectId: zod_1.z.string().uuid(),
    change: zod_1.z.enum(['membership_added', 'membership_removed', 'membership_role_changed']),
    /** The post-change role when one exists; omitted after removal. */
    role: zod_1.z.string().min(1).max(64).optional(),
});
