import { z } from 'zod';
/**
 * Emitted on each app liveness heartbeat. Durable successor to the legacy
 * Socket.io `app-status-changed` emit. Consumers (e.g. the host health
 * projection) read this rather than polling the app's own URL.
 */
export declare const appHeartbeatSchemaV1: any;
export type AppHeartbeatPayloadV1 = z.infer<typeof appHeartbeatSchemaV1>;
