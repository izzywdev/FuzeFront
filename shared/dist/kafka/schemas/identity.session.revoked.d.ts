import { z } from 'zod';
/**
 * Topic: `identity.session.revoked`
 * Emitted when a session is invalidated (logout, admin revoke, rotation).
 * Consumers of @fuzefront/auth (#117) can drop cached identities on revoke.
 */
export declare const identitySessionRevokedSchemaV1: z.ZodObject<{
    userId: z.ZodString;
    sessionId: z.ZodString;
    /** Why the session was revoked. */
    reason: z.ZodEnum<["logout", "admin-revoke", "rotation", "expired"]>;
    /** When the revocation happened, ISO-8601. */
    revokedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    userId: string;
    sessionId: string;
    reason: "expired" | "logout" | "admin-revoke" | "rotation";
    revokedAt: string;
}, {
    userId: string;
    sessionId: string;
    reason: "expired" | "logout" | "admin-revoke" | "rotation";
    revokedAt: string;
}>;
export type IdentitySessionRevokedPayloadV1 = z.infer<typeof identitySessionRevokedSchemaV1>;
