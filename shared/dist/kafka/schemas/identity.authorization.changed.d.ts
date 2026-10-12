import { z } from 'zod';
export declare const identityAuthorizationChangedSchemaV1: z.ZodObject<{
    organizationId: z.ZodString;
    subjectId: z.ZodString;
    change: z.ZodEnum<["membership_added", "membership_removed", "membership_role_changed"]>;
    role: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    subjectId: string;
    change: "membership_added" | "membership_removed" | "membership_role_changed";
    role?: string | undefined;
}, {
    organizationId: string;
    subjectId: string;
    change: "membership_added" | "membership_removed" | "membership_role_changed";
    role?: string | undefined;
}>;
export type IdentityAuthorizationChangedPayloadV1 = z.infer<typeof identityAuthorizationChangedSchemaV1>;
