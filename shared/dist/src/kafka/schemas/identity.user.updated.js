"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityUserUpdatedSchemaV1 = void 0;
const zod_1 = require("zod");
/**
 * Emitted when a user's mutable profile fields change. Carries the fields
 * downstream services mirror (Permit user attributes, IdP profile) so they can
 * re-sync from the event alone.
 */
exports.identityUserUpdatedSchemaV1 = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    email: zod_1.z.string().email(),
    firstName: zod_1.z.string().optional(),
    lastName: zod_1.z.string().optional(),
    homePortalId: zod_1.z.string().uuid().nullable().optional(),
});
