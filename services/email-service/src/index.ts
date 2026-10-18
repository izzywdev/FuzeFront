import {
  createKafkaClient,
  TypedProducer,
  TypedConsumer,
  TOPICS,
  notifyEmailRequestedSchemaV1,
} from '@fuzefront/shared/kafka';
import { initTelemetry, type TelemetryHandle } from '@fuzefront/telemetry';
import { loadConfig } from './config';
import { createProvider } from './providers';
import { handleEmailRequested } from './handlers/email-requested.handler';
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
  serviceName: 'email-service',
  serviceVersion: SERVICE_VERSION,
});

async function main() {
  const config = loadConfig();

  // --- Email provider ---
  const provider = createProvider(config);

  // --- Kafka ---
  const kafka = createKafkaClient({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
  });

  const statusProducer = new TypedProducer(kafka);
  await statusProducer.connect();

  const consumer = new TypedConsumer(kafka, config.kafka.groupId);
  await consumer.connect();
  await consumer.subscribe(TOPICS.NOTIFY_EMAIL_REQUESTED);
  await consumer.run(
    (event) => handleEmailRequested(event as any, { provider, statusProducer, from: config.email.from }),
    notifyEmailRequestedSchemaV1,
    statusProducer
  );

  // --- HTTP ---
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[email-service] Listening on port ${config.port}`);
  });

  // --- Graceful shutdown ---
  const shutdown = async () => {
    console.log('[email-service] Shutting down...');
    // Close the listener (letting in-flight requests finish) BEFORE flushing
    // telemetry — otherwise a request still in flight when SIGTERM arrives
    // either finishes after the SDK has shut down (its span lost) or is cut
    // off by process.exit(0) below.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Each disconnect is isolated: if the broker is unavailable during
    // SIGTERM and one of these rejects, an unguarded `await` chain would
    // abort right there, skipping the telemetry flush below — leaving
    // buffered spans dropped and the process hung for Kubernetes to kill.
    // Caught by a Codex review on PR #1489 (provisioning-service had the
    // identical ordering, fixed alongside).
    await consumer.disconnect().catch((error) => {
      console.error('[email-service] Error disconnecting the Kafka consumer during shutdown:', error);
    });
    await statusProducer.disconnect().catch((error) => {
      console.error('[email-service] Error disconnecting the status producer during shutdown:', error);
    });
    // Flush any spans still buffered before the process exits — otherwise the
    // last few requests before shutdown silently never reach Tempo.
    await telemetry.shutdown().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[email-service] Fatal error:', err);
  process.exit(1);
});
