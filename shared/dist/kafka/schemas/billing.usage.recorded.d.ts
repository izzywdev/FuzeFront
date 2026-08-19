import { z } from 'zod';
export declare const billingUsageRecordedSchemaV1: z.ZodObject<{
    entityId: z.ZodString;
    entityType: z.ZodEnum<["user", "organization"]>;
    meterEventName: z.ZodString;
    quantity: z.ZodNumber;
    occurredAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    entityType: "user" | "organization";
    entityId: string;
    occurredAt: string;
    meterEventName: string;
    quantity: number;
}, {
    entityType: "user" | "organization";
    entityId: string;
    occurredAt: string;
    meterEventName: string;
    quantity: number;
}>;
export type BillingUsageRecordedPayloadV1 = z.infer<typeof billingUsageRecordedSchemaV1>;
