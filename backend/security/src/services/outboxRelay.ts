// Outbox relay for security-service.
//
// The generic wiring (topic→schema validation, partition-key derivation, Kafka
// publish/DLQ adapter) now lives in @fuzefront/core so every backend service —
// and the Python `fuzefront-events` mirror — shares one install-and-go surface.
// This module is a thin binding: it hands core the service's `db` singleton and
// a labelled logger.
import { db, startOutboxRelayFromEnv, OutboxRelayHandle } from '@fuzefront/core'

/**
 * Start the transactional-outbox relay if a Kafka broker is configured. Returns
 * a handle, or null when KAFKA_BROKERS is unset — then events stay durably in
 * `event_outbox` (and reconcile-on-login still provisions), exactly as before.
 */
export function startOutboxRelayIfConfigured(): OutboxRelayHandle | null {
  return startOutboxRelayFromEnv({
    db,
    clientId: process.env.KAFKA_CLIENT_ID || 'fuzefront-outbox-relay',
    logger: {
      info: m => console.log(`[outbox-relay] ${m}`),
      error: m => console.error(`[outbox-relay] ${m}`),
    },
  })
}
