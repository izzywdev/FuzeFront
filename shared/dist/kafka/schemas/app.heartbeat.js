"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appHeartbeatSchemaV1 = void 0;
const zod_1 = require("zod");
/**
 * Emitted on each app liveness heartbeat. Durable successor to the legacy
 * Socket.io `app-status-changed` emit. Consumers (e.g. the host health
 * projection) read this rather than polling the app's own URL.
 */
exports.appHeartbeatSchemaV1 = zod_1.z.object({
    slug: zod_1.z.string(),
    status: zod_1.z.enum(['online', 'degraded']),
    /** Free-form app-reported metadata (version, build, region, …) */
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    seenAt: zod_1.z.string().datetime(),
});
