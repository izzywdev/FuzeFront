import { z } from 'zod';
export declare const billingUsageRecordedSchemaV1: z.ZodObject<{
    entityId: z.ZodString;
    entityType: z.ZodEnum<["user", "organization"]>;
    meterEventName: z.ZodString;
    quantity: z.ZodNumber;
    occurredAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    occurredAt: string;
    entityType: "user" | "organization";
    entityId: string;
    meterEventName: string;
    quantity: number;
}, {
    occurredAt: string;
    entityType: "user" | "organization";
    entityId: string;
    meterEventName: string;
    quantity: number;
}>;
export type BillingUsageRecordedPayloadV1 = z.infer<typeof billingUsageRecordedSchemaV1>;
