// index.ts — entry point for selection-list-service.
//
// Startup sequence:
//   0. Install the process-level failure policy (lib/http.ts installProcessHandlers).
//   1. Validate required env vars (JWT_SECRET).
//   2. Run pending DB migrations (idempotent knex migrate:latest), then validate the seed packs +
//      seed-sources file and sync the seed allowlist table (fatal when invalid).
//   3. Initialize the family flag client (Unleash via @fuzefront/feature-flags;
//      bounded, never fatal — fail-closed OFF when unreachable/unconfigured).
//   4. Start the HTTP server on $PORT (default 3011).
//   5. Start the Kafka lifecycle consumers (non-fatal).
//   5b. Start the transactional-outbox relay, ONLY when KAFKA_BROKERS is set
//       (non-fatal; events otherwise wait durably in event_outbox).
//   6. Register SIGTERM/SIGINT handlers for graceful shutdown.
//
// The migration step runs in-process so the pre-sync Helm Job (which runs
// `node dist/db/migrate.js` directly) and the app start-up share the same
// migration runner. If the Job is used the migration step here is a no-op
// (knex skips already-applied migrations).

import type { Server } from 'http';
import { createApp } from './app';
import { db } from './db';
import { run as runMigrations } from './db/migrate';
import { startLifecycleConsumers } from './events/consumer';
import { OutboxRelayFromEnvHandle, startOutboxRelayFromEnv } from './events/outboxPublisher';
import { closeFeatureFlags, initFeatureFlags } from './lib/featureFlags';
import { installProcessHandlers } from './lib/http';
import { logger } from './lib/logger';
import { logMachineIdentityStatus } from './lib/machineIdentity';
import { initSeeding } from './seed';

/** Hard ceiling on graceful shutdown; after this the process exits regardless. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

let server: Server | undefined;
let disconnectConsumers: (() => Promise<void>) | null = null;
let outboxRelay: OutboxRelayFromEnvHandle | null = null;
let shuttingDown = false;

/**
 * Graceful shutdown: stop consuming, stop accepting connections and let
 * in-flight requests finish, stop flag polling, close the DB pool, exit.
 * Idempotent (a second signal or an exception during shutdown is a no-op) and
 * bounded by SHUTDOWN_TIMEOUT_MS.
 */
async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason, exitCode }, 'Shutting down');

  const force = setTimeout(() => {
    logger.error({ reason }, 'graceful shutdown timed out — forcing exit');
    process.exit(exitCode || 1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();

  if (outboxRelay) {
    // Let the in-flight relay pass finish its current row, then release the producer.
    await outboxRelay.stop().catch((err) => logger.warn({ err }, 'outbox relay stop failed during shutdown'));
    await outboxRelay.disconnect().catch((err) => logger.warn({ err }, 'outbox producer disconnect failed during shutdown'));
  }
  if (disconnectConsumers) {
    await disconnectConsumers().catch((err) => logger.warn({ err }, 'Kafka disconnect failed during shutdown'));
  }
  await closeFeatureFlags();
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  await db.destroy().catch((err) => logger.warn({ err }, 'DB pool close failed during shutdown'));
  process.exit(exitCode);
}

async function main(): Promise<void> {
  // First: from here on, an unhandled rejection is logged (never silent, never
  // fatal) and an uncaught exception shuts down gracefully with exit 1.
  installProcessHandlers({ shutdown });

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    logger.fatal('JWT_SECRET is not set — refusing to start');
    process.exit(1);
  }

  // Run pending migrations before accepting traffic.
  try {
    const applied = await runMigrations();
    if (applied.length > 0) {
      logger.info({ count: applied.length, migrations: applied }, 'Applied migration(s)');
    } else {
      logger.info('DB schema up to date');
    }
  } catch (err) {
    logger.fatal({ err }, 'Migration failed');
    await db.destroy().catch(() => {});
    process.exit(1);
  }

  // Validate every shipped platform seed pack and the seed-source allowlist, and sync the allowlist
  // into its table (plan sections 8 and 10). Refuse to boot on an invalid file rather than fail on the
  // first org. This only reads files and writes the allowlist table: nothing is seeded here (seeding
  // is behind fuzefront.selection-lists.seed-defaults and is driven by consumers that do not exist yet).
  try {
    await initSeeding(db);
  } catch (err) {
    logger.fatal({ err }, 'Seed packs / seed-sources invalid or allowlist sync failed');
    await db.destroy().catch(() => {});
    process.exit(1);
  }

  // Release flag provider (rollout runbook B4). Bounded and non-fatal: if Unleash
  // is down/unconfigured every flag evaluates to its fail-safe default (OFF).
  await initFeatureFlags();

  // Make a missing machine identity (access-grant writes) loud at boot.
  logMachineIdentityStatus();

  const app = createApp();
  const port = parseInt(process.env.PORT || '3011', 10);

  server = app.listen(port, () => {
    logger.info({ port, logLevel: logger.level }, 'Listening');
  });

  // Start Kafka lifecycle consumers (fire-and-forget; errors are logged but do
  // not kill the HTTP server — a Kafka outage must not bring the API down).
  if (process.env.KAFKA_BROKERS || process.env.NODE_ENV === 'production') {
    startLifecycleConsumers()
      .then(({ disconnect }) => {
        disconnectConsumers = disconnect;
        logger.info('Kafka lifecycle consumers started');
      })
      .catch((err) => {
        logger.error({ err }, 'Failed to start Kafka consumers (non-fatal)');
      });
  }

  // Transactional-outbox relay: publishes the events the routes wrote in their
  // own transactions. Only when Kafka is configured; never fatal (a relay error
  // is contained inside the relay and cannot take the HTTP server down).
  try {
    outboxRelay = startOutboxRelayFromEnv({ db, logger });
  } catch (err) {
    logger.error({ err }, 'Failed to start the outbox relay (non-fatal)');
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
