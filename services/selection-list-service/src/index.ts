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

async function main(): Promise<void> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    // eslint-disable-next-line no-console
    console.error('[selection-list-service] FATAL: JWT_SECRET is not set.');
    process.exit(1);
  }

  // Run pending migrations before accepting traffic.
  try {
    const applied = await runMigrations();
    if (applied.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[selection-list-service] Applied %d migration(s):', applied.length, applied);
    } else {
      // eslint-disable-next-line no-console
      console.log('[selection-list-service] DB schema up to date.');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[selection-list-service] Migration failed:', err);
    await db.destroy().catch(() => {});
    process.exit(1);
  }

  const app = createApp();
  const port = parseInt(process.env.PORT || '3011', 10);

  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log('[selection-list-service] Listening on port %d', port);
  });

  const shutdown = async (): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[selection-list-service] Shutting down...');
    server.close(async () => {
      await db.destroy().catch(() => {});
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[selection-list-service] Fatal error:', err);
  process.exit(1);
});
