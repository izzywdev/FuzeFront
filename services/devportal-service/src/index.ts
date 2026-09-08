// index.ts — entry point for devportal-service.
//
// Startup sequence:
//   1. Validate required env vars (DEVPORTAL_JWT_SECRET).
//   2. Run pending DB migrations (idempotent knex migrate:latest).
//   3. Bootstrap-harvest bundled specs (idempotent upsert).
//   4. Start the HTTP server on $PORT (default 3013).
//   5. Register SIGTERM/SIGINT handlers for graceful shutdown.

import { createApp } from './app';
import { db } from './db';
import { run as runMigrations } from './db/migrate';
import { runBootstrapHarvest } from './services/bootstrapHarvest';

async function main(): Promise<void> {
  const jwtSecret = process.env.DEVPORTAL_JWT_SECRET;
  if (!jwtSecret) {
    console.error('[devportal-service] FATAL: DEVPORTAL_JWT_SECRET is not set.');
    process.exit(1);
  }

  try {
    const applied = await runMigrations();
    if (applied.length > 0) {
      console.log('[devportal-service] Applied %d migration(s):', applied.length, applied);
    } else {
      console.log('[devportal-service] DB schema up to date.');
    }
  } catch (err) {
    console.error('[devportal-service] Migration failed:', err);
    await db.destroy().catch(() => {});
    process.exit(1);
  }

  try {
    const { harvested, failed } = await runBootstrapHarvest();
    console.log(`[devportal-service] Bootstrap harvest: ${harvested} spec(s) harvested, ${failed} failed.`);
  } catch (err) {
    // Never fatal — a harvest failure means a stale/empty catalog, not a
    // reason to refuse traffic (auth/playground/health all still work).
    console.error('[devportal-service] Bootstrap harvest threw:', err);
  }

  const app = createApp();
  const port = parseInt(process.env.PORT || '3013', 10);

  const server = app.listen(port, () => {
    console.log('[devportal-service] Listening on port %d', port);
  });

  const shutdown = async (): Promise<void> => {
    console.log('[devportal-service] Shutting down...');
    server.close(async () => {
      await db.destroy().catch(() => {});
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  console.error('[devportal-service] Fatal error:', err);
  process.exit(1);
});
