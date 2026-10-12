import { z } from 'zod';
export declare const SUPPORTED_TEMPLATES: readonly ["welcome", "org-invite", "membership-change", "fuzepicker-mention", "fuzepicker-reply"];
export declare const notifyEmailRequestedSchemaV1: z.ZodObject<{
    to: z.ZodString;
    template: z.ZodEnum<["welcome", "org-invite", "membership-change", "fuzepicker-mention", "fuzepicker-reply"]>;
    vars: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    orgId: z.ZodOptional<z.ZodString>;
    correlationId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    correlationId: string;
    to: string;
    template: "org-invite" | "welcome" | "membership-change" | "fuzepicker-mention" | "fuzepicker-reply";
    vars: Record<string, unknown>;
    orgId?: string | undefined;
}, {
    correlationId: string;
    to: string;
    template: "org-invite" | "welcome" | "membership-change" | "fuzepicker-mention" | "fuzepicker-reply";
    vars: Record<string, unknown>;
    orgId?: string | undefined;
}>;
export type NotifyEmailRequestedPayloadV1 = z.infer<typeof notifyEmailRequestedSchemaV1>;
