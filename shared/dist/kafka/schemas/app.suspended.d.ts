import { z } from 'zod';
/**
 * Emitted when an app transitions to `suspended` (hidden from the menu, retained).
 */
export declare const appSuspendedSchemaV1: z.ZodObject<{
    slug: z.ZodString;
    organizationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    actorUserId: z.ZodOptional<z.ZodString>;
    suspendedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    slug: string;
    suspendedAt: string;
    organizationId?: string | null | undefined;
    actorUserId?: string | undefined;
}, {
    slug: string;
    suspendedAt: string;
    organizationId?: string | null | undefined;
    actorUserId?: string | undefined;
}>;
export type AppSuspendedPayloadV1 = z.infer<typeof appSuspendedSchemaV1>;
