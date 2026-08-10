import { z } from 'zod';
/**
 * Carried by both membership lifecycle events: a user joining or leaving an
 * organization with a given role. Downstream authorization (Permit role
 * assignment) reacts to these.
 */
export declare const membershipChangeSchemaV1: z.ZodObject<{
    organizationId: z.ZodString;
    userId: z.ZodString;
    role: z.ZodString;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    userId: string;
    role: string;
}, {
    organizationId: string;
    userId: string;
    role: string;
}>;
export declare const identityMembershipAddedSchemaV1: z.ZodObject<{
    organizationId: z.ZodString;
    userId: z.ZodString;
    role: z.ZodString;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    userId: string;
    role: string;
}, {
    organizationId: string;
    userId: string;
    role: string;
}>;
export type IdentityMembershipAddedPayloadV1 = z.infer<typeof identityMembershipAddedSchemaV1>;
