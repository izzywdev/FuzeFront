"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityMembershipAddedSchemaV1 = exports.membershipChangeSchemaV1 = void 0;
const zod_1 = require("zod");
/**
 * Carried by both membership lifecycle events: a user joining or leaving an
 * organization with a given role. Downstream authorization (Permit role
 * assignment) reacts to these.
 */
exports.membershipChangeSchemaV1 = zod_1.z.object({
    organizationId: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    role: zod_1.z.string(),
});
exports.identityMembershipAddedSchemaV1 = exports.membershipChangeSchemaV1;
