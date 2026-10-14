// index.ts — entry point for devportal-service.
//
// Startup sequence:
//   1. Validate required env vars (JWT_SECRET — the platform secret this
//      service VERIFIES sessions with; see middleware/auth.ts).
//   2. Run pending DB migrations (idempotent knex migrate:latest).
//   3. Bootstrap-harvest bundled specs (idempotent upsert).
//   4. Start the HTTP server on $PORT (default 3013).
//   5. Register SIGTERM/SIGINT handlers for graceful shutdown.

import { initTelemetry, type TelemetryHandle } from '@fuzefront/telemetry';
import { createApp } from './app';
import { db } from './db';
import { run as runMigrations } from './db/migrate';
import { runBootstrapHarvest } from './services/bootstrapHarvest';

// Bootstrap OpenTelemetry BEFORE the express app is constructed below (see
// backend/security/src/index.ts for the full rationale). Sends OTLP to
// FuzeInfra's Collector; endpoint/protocol/sampling default from OTEL_* env.
// npm_package_version is only set by an npm lifecycle script; the production
// Dockerfile runs `node dist/index.js` directly, so it's always undefined
// there and every span's service.version would be silently empty. Read the
// version straight from package.json instead.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SERVICE_VERSION: string = require('../package.json').version;
const telemetry: TelemetryHandle = initTelemetry({
  serviceName: 'devportal-service',
  serviceVersion: SERVICE_VERSION,
});

async function main(): Promise<void> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error('[devportal-service] FATAL: JWT_SECRET is not set.');
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
      // Flush any spans still buffered before the process exits — otherwise
      // the last few requests before shutdown silently never reach Tempo.
      await telemetry.shutdown().catch(() => {});
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
