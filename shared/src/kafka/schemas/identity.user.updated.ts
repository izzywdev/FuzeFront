import { z } from 'zod';

/**
 * Emitted when a user's mutable profile fields change. Carries the fields
 * downstream services mirror (Permit user attributes, IdP profile) so they can
 * re-sync from the event alone.
 */
export const identityUserUpdatedSchemaV1 = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  homePortalId: z.string().uuid().nullable().optional(),
});

export type IdentityUserUpdatedPayloadV1 = z.infer<typeof identityUserUpdatedSchemaV1>;
