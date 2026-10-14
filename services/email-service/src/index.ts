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
const telemetry: TelemetryHandle = initTelemetry({
  serviceName: 'email-service',
  serviceVersion: process.env.npm_package_version,
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
  app.listen(config.port, () => {
    console.log(`[email-service] Listening on port ${config.port}`);
  });

  // --- Graceful shutdown ---
  const shutdown = async () => {
    console.log('[email-service] Shutting down...');
    await consumer.disconnect();
    await statusProducer.disconnect();
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
