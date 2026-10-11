import { z } from 'zod';
export declare const billingTrialEndingSchemaV1: z.ZodObject<{
    entityId: z.ZodString;
    entityType: z.ZodEnum<["user", "organization"]>;
    /** ISO-8601 datetime when the trial period ends. */
    trialEnd: z.ZodString;
    /** Stripe / catalogue tier name (e.g. 'professional'). */
    planTier: z.ZodString;
}, "strip", z.ZodTypeAny, {
    entityType: "user" | "organization";
    entityId: string;
    planTier: string;
    trialEnd: string;
}, {
    entityType: "user" | "organization";
    entityId: string;
    planTier: string;
    trialEnd: string;
}>;
export type BillingTrialEndingPayloadV1 = z.infer<typeof billingTrialEndingSchemaV1>;
