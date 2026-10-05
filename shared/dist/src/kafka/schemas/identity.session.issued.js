"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identitySessionIssuedSchemaV1 = void 0;
const zod_1 = require("zod");
/**
 * Topic: `identity.session.issued`
 * Emitted when the identity service issues an auth session token for a
 * principal (local login or OIDC callback). Part of the @fuzefront/auth
 * contract (#117): consumers can react to sessions without parsing tokens.
 *
 * NOTE: never carries the token itself — only non-secret session metadata.
 */
exports.identitySessionIssuedSchemaV1 = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    /** Opaque session identifier (matches the token's `sessionId` claim when present). */
    sessionId: zod_1.z.string(),
    /** Tenant/organization scope, or null when unresolved (legacy-hs256 mode). */
    tenantId: zod_1.z.string().uuid().nullable(),
    /** Which verifier mode issued/backs this session. */
    authMode: zod_1.z.enum(['legacy-hs256', 'oidc-jwks']),
    /** Issuer (`iss`) — the Authentik issuer URL in oidc-jwks mode, else null. */
    issuer: zod_1.z.string().url().nullable().optional(),
    /** Token expiry, epoch seconds. */
    expiresAt: zod_1.z.number().int().positive(),
    /** When the session was issued, ISO-8601. */
    issuedAt: zod_1.z.string().datetime(),
});
