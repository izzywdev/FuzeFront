import {
  createKafkaClient,
  TypedProducer,
  TypedConsumer,
  TOPICS,
  identityUserCreatedSchemaV1,
} from '@fuzefront/shared/kafka';
import { loadConfig } from './config';
import { handleUserCreated } from './handler';
import { createApp } from './app';

async function main() {
  const config = loadConfig();

  // --- Kafka ---
  const kafka = createKafkaClient({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
  });

  // DLQ producer: forwards poison/schema-invalid messages to identity.user.created.dlq
  const dlqProducer = new TypedProducer(kafka);
  await dlqProducer.connect();

  const consumer = new TypedConsumer(kafka, config.kafka.groupId);
  await consumer.connect();
  await consumer.subscribe(TOPICS.IDENTITY_USER_CREATED);
  await consumer.run(
    (event) =>
      handleUserCreated(event as any, {
        securityServiceUrl: config.securityServiceUrl,
        internalProvisionSecret: config.internalProvisionSecret,
      }),
    identityUserCreatedSchemaV1,
    dlqProducer
  );

  // --- HTTP health probe ---
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[provisioning-service] Listening on port ${config.port}`);
  });

  // --- Graceful shutdown ---
  const shutdown = async () => {
    console.log('[provisioning-service] Shutting down...');
    await consumer.disconnect();
    await dlqProducer.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[provisioning-service] Fatal error:', err);
  process.exit(1);
});
