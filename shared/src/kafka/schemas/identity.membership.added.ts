import { z } from 'zod';

/**
 * Carried by both membership lifecycle events: a user joining or leaving an
 * organization with a given role. Downstream authorization (Permit role
 * assignment) reacts to these.
 */
export const membershipChangeSchemaV1 = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.string(),
});

export const identityMembershipAddedSchemaV1 = membershipChangeSchemaV1;

export type IdentityMembershipAddedPayloadV1 = z.infer<typeof identityMembershipAddedSchemaV1>;
