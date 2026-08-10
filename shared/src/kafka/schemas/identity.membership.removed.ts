import { z } from 'zod';
import { membershipChangeSchemaV1 } from './identity.membership.added';

/** Emitted when a user's membership in an organization is revoked. */
export const identityMembershipRemovedSchemaV1 = membershipChangeSchemaV1;

export type IdentityMembershipRemovedPayloadV1 = z.infer<typeof identityMembershipRemovedSchemaV1>;
