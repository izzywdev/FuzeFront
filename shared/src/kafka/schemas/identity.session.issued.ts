import { z } from 'zod';

/**
 * Topic: `identity.session.issued`
 * Emitted when the identity service issues an auth session token for a
 * principal (local login or OIDC callback). Part of the @fuzefront/auth
 * contract (#117): consumers can react to sessions without parsing tokens.
 *
 * NOTE: never carries the token itself — only non-secret session metadata.
 */
export const identitySessionIssuedSchemaV1 = z.object({
  userId: z.string().uuid(),
  /** Opaque session identifier (matches the token's `sessionId` claim when present). */
  sessionId: z.string(),
  /** Tenant/organization scope, or null when unresolved (legacy-hs256 mode). */
  tenantId: z.string().uuid().nullable(),
  /** Which verifier mode issued/backs this session. */
  authMode: z.enum(['legacy-hs256', 'oidc-jwks']),
  /** Issuer (`iss`) — the Authentik issuer URL in oidc-jwks mode, else null. */
  issuer: z.string().url().nullable().optional(),
  /** Token expiry, epoch seconds. */
  expiresAt: z.number().int().positive(),
  /** When the session was issued, ISO-8601. */
  issuedAt: z.string().datetime(),
});

export type IdentitySessionIssuedPayloadV1 = z.infer<typeof identitySessionIssuedSchemaV1>;
