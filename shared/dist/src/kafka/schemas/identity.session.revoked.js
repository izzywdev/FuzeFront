"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identitySessionRevokedSchemaV1 = void 0;
const zod_1 = require("zod");
/**
 * Topic: `identity.session.revoked`
 * Emitted when a session is invalidated (logout, admin revoke, rotation).
 * Consumers of @fuzefront/auth (#117) can drop cached identities on revoke.
 */
exports.identitySessionRevokedSchemaV1 = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    sessionId: zod_1.z.string(),
    /** Why the session was revoked. */
    reason: zod_1.z.enum(['logout', 'admin-revoke', 'rotation', 'expired']),
    /** When the revocation happened, ISO-8601. */
    revokedAt: zod_1.z.string().datetime(),
});
