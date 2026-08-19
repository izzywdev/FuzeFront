import { z } from 'zod';
export declare const billingSubscriptionChangedSchemaV1: z.ZodObject<{
    entityId: z.ZodString;
    entityType: z.ZodEnum<["user", "organization"]>;
    planTier: z.ZodString;
    /** Mirrors Stripe subscription status values (active, trialing, past_due, canceled, etc.) */
    status: z.ZodString;
    seatQuantity: z.ZodOptional<z.ZodNumber>;
    stripeSubscriptionId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: string;
    entityType: "user" | "organization";
    entityId: string;
    planTier: string;
    stripeSubscriptionId: string;
    seatQuantity?: number | undefined;
}, {
    status: string;
    entityType: "user" | "organization";
    entityId: string;
    planTier: string;
    stripeSubscriptionId: string;
    seatQuantity?: number | undefined;
}>;
export type BillingSubscriptionChangedPayloadV1 = z.infer<typeof billingSubscriptionChangedSchemaV1>;
