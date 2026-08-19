import { z } from 'zod';
/**
 * Emitted when an app is registered in the app registry.
 * Durable, cross-service successor to the legacy Socket.io `app-registered` emit.
 */
export declare const appRegisteredSchemaV1: z.ZodObject<{
    slug: z.ZodString;
    name: z.ZodString;
    mode: z.ZodEnum<["portal", "standalone"]>;
    integrationType: z.ZodEnum<["module-federation", "iframe", "web-component", "spa"]>;
    builtin: z.ZodBoolean;
    organizationId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    /** ISO-8601 registration timestamp */
    registeredAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    slug: string;
    name: string;
    mode: "portal" | "standalone";
    integrationType: "module-federation" | "iframe" | "web-component" | "spa";
    builtin: boolean;
    registeredAt: string;
    organizationId?: string | null | undefined;
}, {
    slug: string;
    name: string;
    mode: "portal" | "standalone";
    integrationType: "module-federation" | "iframe" | "web-component" | "spa";
    builtin: boolean;
    registeredAt: string;
    organizationId?: string | null | undefined;
}>;
export type AppRegisteredPayloadV1 = z.infer<typeof appRegisteredSchemaV1>;
