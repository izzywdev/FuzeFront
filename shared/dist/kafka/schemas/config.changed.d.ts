import { z } from 'zod';
/**
 * Emitted by config-service after a write to ONE `(namespace, scope)` COMMITS
 * (FF-EPIC-18-S4 / FFRNT-262). A multi-key `ConfigWriteRequest` coalesces into a
 * single event listing every changed key — never one event per key.
 *
 * Deliberately carries NO VALUES — key NAMES and scope only. Config values can
 * be secrets (`isSecret`), and an event bus is not a place a secret may ever
 * travel; consumers that need the new value re-resolve it from config-service
 * (which applies redaction and authorization). This is an invalidation signal,
 * not a change feed.
 *
 * Delivery is best-effort: a missed event is recovered by the ETag /
 * resolved-version poll (FF-EPIC-18-S5). Consumers MUST handle both.
 */
export declare const configChangedSchemaV1: z.ZodObject<{
    namespace: z.ZodString;
    scope: z.ZodObject<{
        scopeType: z.ZodEnum<["platform", "portal", "org", "user"]>;
        /** Null exactly when `scopeType` is `platform`. */
        scopeId: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        scopeType: "portal" | "user" | "platform" | "org";
        scopeId: string | null;
    }, {
        scopeType: "portal" | "user" | "platform" | "org";
        scopeId: string | null;
    }>;
    /** Key names only (never values). Non-empty, de-duplicated by the producer. */
    changedKeys: z.ZodArray<z.ZodString, "many">;
}, "strict", z.ZodTypeAny, {
    scope: {
        scopeType: "portal" | "user" | "platform" | "org";
        scopeId: string | null;
    };
    namespace: string;
    changedKeys: string[];
}, {
    scope: {
        scopeType: "portal" | "user" | "platform" | "org";
        scopeId: string | null;
    };
    namespace: string;
    changedKeys: string[];
}>;
export type ConfigChangedPayloadV1 = z.infer<typeof configChangedSchemaV1>;
