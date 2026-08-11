import { z } from 'zod';
export declare const billingPaymentMethodUpdatedSchemaV1: z.ZodObject<{
    entityId: z.ZodString;
    entityType: z.ZodEnum<["user", "organization"]>;
    stripeCustomerId: z.ZodString;
    paymentMethodId: z.ZodString;
    /** e.g. 'visa', 'mastercard' — omitted for non-card payment methods. */
    brand: z.ZodOptional<z.ZodString>;
    last4: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    entityType: "user" | "organization";
    entityId: string;
    stripeCustomerId: string;
    paymentMethodId: string;
    brand?: string | undefined;
    last4?: string | undefined;
}, {
    entityType: "user" | "organization";
    entityId: string;
    stripeCustomerId: string;
    paymentMethodId: string;
    brand?: string | undefined;
    last4?: string | undefined;
}>;
export type BillingPaymentMethodUpdatedPayloadV1 = z.infer<typeof billingPaymentMethodUpdatedSchemaV1>;
