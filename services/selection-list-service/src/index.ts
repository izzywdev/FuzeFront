// index.ts — entry point for selection-list-service.
//
// Startup sequence:
//   1. Validate required env vars (JWT_SECRET).
//   2. Run pending DB migrations (idempotent knex migrate:latest).
//   3. Start the HTTP server on $PORT (default 3011).
//   4. Register SIGTERM/SIGINT handlers for graceful shutdown.
//
// The migration step runs in-process so the pre-sync Helm Job (which runs
// `node dist/db/migrate.js` directly) and the app start-up share the same
// migration runner. If the Job is used the migration step here is a no-op
// (knex skips already-applied migrations).

import { createApp } from './app';
import { db } from './db';
import { run as runMigrations } from './db/migrate';
import { startLifecycleConsumers } from './events/consumer';
import { logger } from './lib/logger';

async function main(): Promise<void> {
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

  const app = createApp();
  const port = parseInt(process.env.PORT || '3011', 10);

  const server = app.listen(port, () => {
    logger.info({ port, logLevel: logger.level }, 'Listening');
  });

  // Start Kafka lifecycle consumers (fire-and-forget; errors are logged but do
  // not kill the HTTP server — a Kafka outage must not bring the API down).
  let disconnectConsumers: (() => Promise<void>) | null = null;
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

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down');
    if (disconnectConsumers) {
      await disconnectConsumers().catch(() => {});
    }
    server.close(async () => {
      await db.destroy().catch(() => {});
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
