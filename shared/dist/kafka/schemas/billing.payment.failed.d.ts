import { z } from 'zod';
export declare const billingPaymentFailedSchemaV1: z.ZodObject<{
    entityId: z.ZodString;
    entityType: z.ZodEnum<["user", "organization"]>;
    /** Stripe invoice ID (e.g. 'in_1AbcDef...'). */
    invoiceId: z.ZodString;
    /** Amount due in the currency's minor unit (cents for USD). */
    amountDue: z.ZodNumber;
    /** ISO-4217 lowercase currency code (e.g. 'usd'). */
    currency: z.ZodString;
}, "strip", z.ZodTypeAny, {
    entityType: "user" | "organization";
    entityId: string;
    currency: string;
    invoiceId: string;
    amountDue: number;
}, {
    entityType: "user" | "organization";
    entityId: string;
    currency: string;
    invoiceId: string;
    amountDue: number;
}>;
export type BillingPaymentFailedPayloadV1 = z.infer<typeof billingPaymentFailedSchemaV1>;
