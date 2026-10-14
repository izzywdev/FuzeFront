import { initTelemetry, type TelemetryHandle } from '@fuzefront/telemetry';
import { loadConfig } from './config';
import { createTwilioClient } from './twilio-client';
import { RateLimiter } from './rate-limiter';
import { createApp } from './app';

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
  serviceName: 'sms-service',
  serviceVersion: SERVICE_VERSION,
});

async function main() {
  const config = loadConfig();

  const twilioClient = createTwilioClient(config.twilio);
  const rateLimiter = new RateLimiter(config.rateLimiter);

  const app = createApp({
    authSecret: config.authSecret,
    twilioClient,
    verifyServiceSid: config.twilio.verifyServiceSid,
    rateLimiter,
  });

  const server = app.listen(config.port, () => {
    const mode = config.twilio.mock ? 'mock' : 'live';
    console.log(`[sms-service] Listening on port ${config.port} (Twilio: ${mode})`);
  });

  const shutdown = () => {
    console.log('[sms-service] Shutting down...');
    server.close(() => {
      // Flush any spans still buffered before the process exits — otherwise
      // the last few requests before shutdown silently never reach Tempo.
      telemetry.shutdown().catch(() => {}).finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[sms-service] Fatal error:', err);
  process.exit(1);
});
