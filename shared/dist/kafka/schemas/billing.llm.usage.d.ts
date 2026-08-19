import { z } from 'zod';
export declare const billingLlmUsageSchemaV1: z.ZodObject<{
    userId: z.ZodString;
    orgId: z.ZodString;
    model: z.ZodString;
    promptTokens: z.ZodNumber;
    completionTokens: z.ZodNumber;
    totalTokens: z.ZodNumber;
    conversationId: z.ZodString;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    userId: string;
    orgId: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    conversationId: string;
    timestamp: string;
}, {
    userId: string;
    orgId: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    conversationId: string;
    timestamp: string;
}>;
export type BillingLlmUsagePayloadV1 = z.infer<typeof billingLlmUsageSchemaV1>;
