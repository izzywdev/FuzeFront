import { z } from 'zod';

/**
 * Topic: `identity.session.revoked`
 * Emitted when a session is invalidated (logout, admin revoke, rotation).
 * Consumers of @fuzefront/auth (#117) can drop cached identities on revoke.
 */
export const identitySessionRevokedSchemaV1 = z.object({
  userId: z.string().uuid(),
  sessionId: z.string(),
  /** Why the session was revoked. */
  reason: z.enum(['logout', 'admin-revoke', 'rotation', 'expired']),
  /** When the revocation happened, ISO-8601. */
  revokedAt: z.string().datetime(),
});

export type IdentitySessionRevokedPayloadV1 = z.infer<typeof identitySessionRevokedSchemaV1>;
