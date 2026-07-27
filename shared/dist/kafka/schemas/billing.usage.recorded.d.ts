import { z } from 'zod';
export declare const billingUsageRecordedSchemaV1: z.ZodObject<{
    entityId: z.ZodString;
    entityType: z.ZodEnum<["user", "organization"]>;
    meterEventName: z.ZodString;
    quantity: z.ZodNumber;
    occurredAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    entityId: string;
    entityType: "user" | "organization";
    meterEventName: string;
    quantity: number;
    occurredAt: string;
}, {
    entityId: string;
    entityType: "user" | "organization";
    meterEventName: string;
    quantity: number;
    occurredAt: string;
}>;
export type BillingUsageRecordedPayloadV1 = z.infer<typeof billingUsageRecordedSchemaV1>;
