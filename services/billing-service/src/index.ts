import { loadConfig } from './config';
import { createApp } from './app';
import { createPool, runMigrations } from './db';

async function main() {
  const config = loadConfig();

  // --- DB migrations (only when DATABASE_URL is configured) ---
  if (config.databaseUrl) {
    const pool = createPool(config.databaseUrl);
    try {
      await runMigrations(pool);
      console.log('[billing-service] DB migrations complete');
    } catch (err) {
      console.error('[billing-service] DB migration failed (continuing):', err);
    }
  }

  // --- HTTP ---
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[billing-service] Listening on port ${config.port}`);
  });

  // --- Graceful shutdown ---
  // Await server.close so future async teardown (Kafka/DB in later tasks) can be
  // sequenced before exit. Wrap the callback-based close in a Promise.
  const shutdown = async () => {
    console.log('[billing-service] Shutting down...');
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[billing-service] Fatal error:', err);
  process.exit(1);
});
