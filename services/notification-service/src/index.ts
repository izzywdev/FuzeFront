import { initTelemetry, type TelemetryHandle } from '@fuzefront/telemetry';
import { createApp } from './app';
import { loadConfig } from './config';
import { db } from './db';
import { NotificationsRepository } from './db/repositories/notifications';
import { PreferencesRepository } from './db/repositories/preferences';
import { StreamHub } from './stream/hub';

/** How often expired notifications are swept. Cheap (partial index) and idempotent. */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

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
  serviceName: 'notification-service',
  serviceVersion: SERVICE_VERSION,
});

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.jwtSecret) {
    // Fail at startup, not per-request: a service that cannot verify tokens
    // must not accept traffic at all.
    throw new Error('JWT_SECRET is required');
  }
  if (!config.internalToken) {
    // Not fatal — the user-facing inbox works without it. But the publish
    // surface stays disabled (see middleware/auth.requireInternalToken), so say
    // so loudly rather than leaving an operator wondering why nothing arrives.
    // eslint-disable-next-line no-console
    console.warn(
      '[notification-service] NOTIFICATION_INTERNAL_TOKEN unset — /internal/publish is DISABLED.'
    );
  }

  const notifications = new NotificationsRepository(db);
  const preferences = new PreferencesRepository(db);
  const hub = new StreamHub(config.sseHeartbeatMs, config.maxStreamsPerUser);

  const app = createApp({
    notifications: { notifications, preferences, hub },
    rateLimit: config.rateLimit,
  });

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[notification-service] Listening on port ${config.port}`);
  });

  // Long-lived SSE connections would otherwise be cut mid-frame by the default
  // header/keep-alive timeouts.
  server.headersTimeout = 0;
  server.keepAliveTimeout = 0;

  const purge = setInterval(() => {
    notifications
      .purgeExpired()
      .then(count => {
        if (count > 0) {
          // eslint-disable-next-line no-console
          console.log(`[notification-service] Purged ${count} expired notification(s).`);
        }
      })
      .catch(err => {
        // A failed sweep is not fatal — the rows are merely stale.
        // eslint-disable-next-line no-console
        console.warn('[notification-service] Expiry purge failed:', err);
      });
  }, PURGE_INTERVAL_MS);
  if (typeof purge.unref === 'function') purge.unref();

  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('[notification-service] Shutting down...');
    clearInterval(purge);
    // Close streams first so clients reconnect to a healthy pod instead of
    // waiting out a socket that will never speak again.
    hub.closeAll();
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
  // eslint-disable-next-line no-console
  console.error('[notification-service] Fatal error:', err);
  process.exit(1);
});
