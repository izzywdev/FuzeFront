import { z } from 'zod';

/**
 * Emitted when a user is deleted. Thin payload: consumers delete their own
 * per-user state (Permit user, sessions, user-scoped billing) from the id.
 * `cascade` distinguishes deactivation from hard removal.
 */
export const identityUserDeletedSchemaV1 = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  cascade: z.enum(['soft', 'hard']),
});

export type IdentityUserDeletedPayloadV1 = z.infer<typeof identityUserDeletedSchemaV1>;
