"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityUserDeletedSchemaV1 = void 0;
const zod_1 = require("zod");
/**
 * Emitted when a user is deleted. Thin payload: consumers delete their own
 * per-user state (Permit user, sessions, user-scoped billing) from the id.
 * `cascade` distinguishes deactivation from hard removal.
 */
exports.identityUserDeletedSchemaV1 = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    email: zod_1.z.string().email(),
    cascade: zod_1.z.enum(['soft', 'hard']),
});
