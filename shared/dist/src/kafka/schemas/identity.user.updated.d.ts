import { z } from 'zod';
/**
 * Emitted when a user's mutable profile fields change. Carries the fields
 * downstream services mirror (Permit user attributes, IdP profile) so they can
 * re-sync from the event alone.
 */
export declare const identityUserUpdatedSchemaV1: any;
export type IdentityUserUpdatedPayloadV1 = z.infer<typeof identityUserUpdatedSchemaV1>;
