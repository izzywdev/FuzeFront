import { z } from 'zod';
export declare const identityUserCreatedSchemaV1: z.ZodObject<{
    userId: z.ZodString;
    email: z.ZodString;
    firstName: z.ZodOptional<z.ZodString>;
    lastName: z.ZodOptional<z.ZodString>;
    /** Why the user was created: initial sign-up or org invitation */
    intent: z.ZodEnum<["signup", "org-invite"]>;
}, "strip", z.ZodTypeAny, {
    userId: string;
    email: string;
    intent: "signup" | "org-invite";
    firstName?: string | undefined;
    lastName?: string | undefined;
}, {
    userId: string;
    email: string;
    intent: "signup" | "org-invite";
    firstName?: string | undefined;
    lastName?: string | undefined;
}>;
export type IdentityUserCreatedPayloadV1 = z.infer<typeof identityUserCreatedSchemaV1>;
