import { z } from 'zod';
export declare const billingTenantRegisteredSchemaV1: z.ZodObject<{
    entityId: z.ZodString;
    /** Always 'organization' — a new corporate tenant, not a personal account. */
    entityType: z.ZodLiteral<"organization">;
    stripeCustomerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    entityType: "organization";
    entityId: string;
    stripeCustomerId: string;
}, {
    entityType: "organization";
    entityId: string;
    stripeCustomerId: string;
}>;
export type BillingTenantRegisteredPayloadV1 = z.infer<typeof billingTenantRegisteredSchemaV1>;
