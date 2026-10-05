"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configChangedSchemaV1 = void 0;
const zod_1 = require("zod");
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
exports.configChangedSchemaV1 = zod_1.z
    .object({
    namespace: zod_1.z.string().min(1),
    scope: zod_1.z.object({
        scopeType: zod_1.z.enum(['platform', 'portal', 'org', 'user']),
        /** Null exactly when `scopeType` is `platform`. */
        scopeId: zod_1.z.string().nullable(),
    }),
    /** Key names only (never values). Non-empty, de-duplicated by the producer. */
    changedKeys: zod_1.z.array(zod_1.z.string().min(1)).min(1),
})
    .strict();
