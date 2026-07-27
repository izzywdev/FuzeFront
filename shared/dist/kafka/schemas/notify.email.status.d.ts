import { z } from 'zod';
export declare const notifyEmailStatusSchemaV1: z.ZodObject<{
    correlationId: z.ZodString;
    to: z.ZodString;
    template: z.ZodString;
    status: z.ZodEnum<["sent", "failed", "dead-lettered"]>;
    error: z.ZodOptional<z.ZodString>;
    providerMessageId: z.ZodOptional<z.ZodString>;
    attemptedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "sent" | "failed" | "dead-lettered";
    to: string;
    template: string;
    correlationId: string;
    attemptedAt: string;
    error?: string | undefined;
    providerMessageId?: string | undefined;
}, {
    status: "sent" | "failed" | "dead-lettered";
    to: string;
    template: string;
    correlationId: string;
    attemptedAt: string;
    error?: string | undefined;
    providerMessageId?: string | undefined;
}>;
export type NotifyEmailStatusPayloadV1 = z.infer<typeof notifyEmailStatusSchemaV1>;
