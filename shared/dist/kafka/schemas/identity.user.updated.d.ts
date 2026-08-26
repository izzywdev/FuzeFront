import { z } from 'zod';
/**
 * Emitted when a user's mutable profile fields change. Carries the fields
 * downstream services mirror (Permit user attributes, IdP profile) so they can
 * re-sync from the event alone.
 */
export declare const identityUserUpdatedSchemaV1: z.ZodObject<{
    userId: z.ZodString;
    email: z.ZodString;
    firstName: z.ZodOptional<z.ZodString>;
    lastName: z.ZodOptional<z.ZodString>;
    homePortalId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    userId: string;
    email: string;
    firstName?: string | undefined;
    lastName?: string | undefined;
    homePortalId?: string | null | undefined;
}, {
    userId: string;
    email: string;
    firstName?: string | undefined;
    lastName?: string | undefined;
    homePortalId?: string | null | undefined;
}>;
export type IdentityUserUpdatedPayloadV1 = z.infer<typeof identityUserUpdatedSchemaV1>;
