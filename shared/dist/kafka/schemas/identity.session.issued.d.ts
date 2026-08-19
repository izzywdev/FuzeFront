import { z } from 'zod';
/**
 * Topic: `identity.session.issued`
 * Emitted when the identity service issues an auth session token for a
 * principal (local login or OIDC callback). Part of the @fuzefront/auth
 * contract (#117): consumers can react to sessions without parsing tokens.
 *
 * NOTE: never carries the token itself — only non-secret session metadata.
 */
export declare const identitySessionIssuedSchemaV1: z.ZodObject<{
    userId: z.ZodString;
    /** Opaque session identifier (matches the token's `sessionId` claim when present). */
    sessionId: z.ZodString;
    /** Tenant/organization scope, or null when unresolved (legacy-hs256 mode). */
    tenantId: z.ZodNullable<z.ZodString>;
    /** Which verifier mode issued/backs this session. */
    authMode: z.ZodEnum<["legacy-hs256", "oidc-jwks"]>;
    /** Issuer (`iss`) — the Authentik issuer URL in oidc-jwks mode, else null. */
    issuer: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    /** Token expiry, epoch seconds. */
    expiresAt: z.ZodNumber;
    /** When the session was issued, ISO-8601. */
    issuedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    userId: string;
    sessionId: string;
    tenantId: string | null;
    authMode: "legacy-hs256" | "oidc-jwks";
    expiresAt: number;
    issuedAt: string;
    issuer?: string | null | undefined;
}, {
    userId: string;
    sessionId: string;
    tenantId: string | null;
    authMode: "legacy-hs256" | "oidc-jwks";
    expiresAt: number;
    issuedAt: string;
    issuer?: string | null | undefined;
}>;
export type IdentitySessionIssuedPayloadV1 = z.infer<typeof identitySessionIssuedSchemaV1>;
