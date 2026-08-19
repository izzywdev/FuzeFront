import { z } from 'zod';
export declare const SUPPORTED_TEMPLATES: readonly ["welcome", "org-invite", "membership-change"];
export declare const notifyEmailRequestedSchemaV1: z.ZodObject<{
    to: z.ZodString;
    template: z.ZodEnum<["welcome", "org-invite", "membership-change"]>;
    vars: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    orgId: z.ZodOptional<z.ZodString>;
    correlationId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    to: string;
    template: "org-invite" | "welcome" | "membership-change";
    vars: Record<string, unknown>;
    correlationId: string;
    orgId?: string | undefined;
}, {
    to: string;
    template: "org-invite" | "welcome" | "membership-change";
    vars: Record<string, unknown>;
    correlationId: string;
    orgId?: string | undefined;
}>;
export type NotifyEmailRequestedPayloadV1 = z.infer<typeof notifyEmailRequestedSchemaV1>;
