import { z } from 'zod';
/**
 * Carried by both membership lifecycle events: a user joining or leaving an
 * organization with a given role. Downstream authorization (Permit role
 * assignment) reacts to these.
 */
export declare const membershipChangeSchemaV1: any;
export declare const identityMembershipAddedSchemaV1: any;
export type IdentityMembershipAddedPayloadV1 = z.infer<typeof identityMembershipAddedSchemaV1>;
