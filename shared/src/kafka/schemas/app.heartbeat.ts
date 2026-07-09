import { z } from 'zod';

/**
 * Emitted on each app liveness heartbeat. Durable successor to the legacy
 * Socket.io `app-status-changed` emit. Consumers (e.g. the host health
 * projection) read this rather than polling the app's own URL.
 */
export const appHeartbeatSchemaV1 = z.object({
  slug: z.string(),
  status: z.enum(['online', 'degraded']),
  /** Free-form app-reported metadata (version, build, region, …) */
  metadata: z.record(z.string(), z.unknown()).optional(),
  seenAt: z.string().datetime(),
});

export type AppHeartbeatPayloadV1 = z.infer<typeof appHeartbeatSchemaV1>;
