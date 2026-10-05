import { z } from 'zod';
/** Emitted when a user's membership in an organization is revoked. */
export declare const identityMembershipRemovedSchemaV1: any;
export type IdentityMembershipRemovedPayloadV1 = z.infer<typeof identityMembershipRemovedSchemaV1>;
