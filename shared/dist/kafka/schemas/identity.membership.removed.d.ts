import { z } from 'zod';
/** Emitted when a user's membership in an organization is revoked. */
export declare const identityMembershipRemovedSchemaV1: z.ZodObject<{
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
export type IdentityMembershipRemovedPayloadV1 = z.infer<typeof identityMembershipRemovedSchemaV1>;
