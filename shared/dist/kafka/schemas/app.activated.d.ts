import { z } from 'zod';
/**
 * Emitted when an app transitions to `activated` (becomes visible in the menu).
 */
export declare const appActivatedSchemaV1: z.ZodObject<{
    slug: z.ZodString;
    organizationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    /** Platform user id that performed the activation */
    actorUserId: z.ZodOptional<z.ZodString>;
    activatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    slug: string;
    activatedAt: string;
    organizationId?: string | null | undefined;
    actorUserId?: string | undefined;
}, {
    slug: string;
    activatedAt: string;
    organizationId?: string | null | undefined;
    actorUserId?: string | undefined;
}>;
export type AppActivatedPayloadV1 = z.infer<typeof appActivatedSchemaV1>;
