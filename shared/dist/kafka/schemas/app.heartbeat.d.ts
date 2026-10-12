import { z } from 'zod';
/**
 * Emitted on each app liveness heartbeat. Durable successor to the legacy
 * Socket.io `app-status-changed` emit. Consumers (e.g. the host health
 * projection) read this rather than polling the app's own URL.
 */
export declare const appHeartbeatSchemaV1: z.ZodObject<{
    slug: z.ZodString;
    status: z.ZodEnum<["online", "degraded"]>;
    /** Free-form app-reported metadata (version, build, region, …) */
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    seenAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "online" | "degraded";
    slug: string;
    seenAt: string;
    metadata?: Record<string, unknown> | undefined;
}, {
    status: "online" | "degraded";
    slug: string;
    seenAt: string;
    metadata?: Record<string, unknown> | undefined;
}>;
export type AppHeartbeatPayloadV1 = z.infer<typeof appHeartbeatSchemaV1>;
