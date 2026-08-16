import {
  createKafkaClient,
  TypedProducer,
  TypedConsumer,
  TOPICS,
  FuzeEvent,
  IdentityUserCreatedPayloadV1,
  identityUserCreatedSchemaV1,
  IdentityOrgCreatedPayloadV1,
  identityOrgCreatedSchemaV1,
  IdentityOrgUpdatedPayloadV1,
  identityOrgUpdatedSchemaV1,
  IdentityOrgDeletedPayloadV1,
  identityOrgDeletedSchemaV1,
} from '@fuzefront/shared/kafka';
import { loadConfig } from './config';
import {
  handleUserCreated,
  handleOrgCreated,
  handleOrgUpdated,
  handleOrgDeleted,
  HandlerDeps,
} from './handler';
import { createApp } from './app';

async function main() {
  const config = loadConfig();

  // --- Kafka ---
  const kafka = createKafkaClient({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
  });

  // DLQ producer: forwards poison/schema-invalid/handler-failed messages to <topic>.dlq
  const dlqProducer = new TypedProducer(kafka);
  await dlqProducer.connect();

  const handlerDeps: HandlerDeps = {
    securityServiceUrl: config.securityServiceUrl,
    internalProvisionSecret: config.internalProvisionSecret,
  };

  // Wrap a handler so a failure dead-letters the event (the offset still commits
  // and the consumer stays healthy) instead of crashing the loop.
  function withDlq<T>(
    topic: string,
    handler: (event: FuzeEvent<T>) => Promise<void>
  ): (event: FuzeEvent<T>) => Promise<void> {
    return async (event: FuzeEvent<T>) => {
      try {
        await handler(event);
      } catch (err) {
        console.error(
          `[provisioning-service] Handler failed for ${topic} correlationId=${event.correlationId}, routing to DLQ: ${String(err)}`
        );
        await dlqProducer.raw.send({
          topic: `${topic}.dlq`,
          messages: [
            {
              value: JSON.stringify({
                raw: JSON.stringify(event),
                reason: String(err),
                sourceTopic: topic,
              }),
            },
          ],
        });
      }
    };
  }

  // identity.user.created -> provision the user (personal org + Permit wiring)
  const userConsumer = new TypedConsumer(kafka, config.kafka.groupId);
  await userConsumer.connect();
  await userConsumer.subscribe(TOPICS.IDENTITY_USER_CREATED);
  await userConsumer.run(
    withDlq<IdentityUserCreatedPayloadV1>(TOPICS.IDENTITY_USER_CREATED, event =>
      handleUserCreated(event, handlerDeps)
    ),
    identityUserCreatedSchemaV1,
    dlqProducer
  );

  // identity.org.created -> reconcile the org's Permit wiring (via its owner).
  // Separate consumer/group: TypedConsumer.run binds a single schema per loop.
  const orgConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-org`);
  await orgConsumer.connect();
  await orgConsumer.subscribe(TOPICS.IDENTITY_ORG_CREATED);
  await orgConsumer.run(
    withDlq<IdentityOrgCreatedPayloadV1>(TOPICS.IDENTITY_ORG_CREATED, event =>
      handleOrgCreated(event, handlerDeps)
    ),
    identityOrgCreatedSchemaV1,
    dlqProducer
  );

  // identity.org.updated -> re-reconcile the org's Permit wiring.
  const orgUpdatedConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-org-updated`);
  await orgUpdatedConsumer.connect();
  await orgUpdatedConsumer.subscribe(TOPICS.IDENTITY_ORG_UPDATED);
  await orgUpdatedConsumer.run(
    withDlq<IdentityOrgUpdatedPayloadV1>(TOPICS.IDENTITY_ORG_UPDATED, event =>
      handleOrgUpdated(event, handlerDeps)
    ),
    identityOrgUpdatedSchemaV1,
    dlqProducer
  );

  // identity.org.deleted -> tear down the org's Permit access (soft/hard).
  const orgDeletedConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-org-deleted`);
  await orgDeletedConsumer.connect();
  await orgDeletedConsumer.subscribe(TOPICS.IDENTITY_ORG_DELETED);
  await orgDeletedConsumer.run(
    withDlq<IdentityOrgDeletedPayloadV1>(TOPICS.IDENTITY_ORG_DELETED, event =>
      handleOrgDeleted(event, handlerDeps)
    ),
    identityOrgDeletedSchemaV1,
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
    await userConsumer.disconnect();
    await orgConsumer.disconnect();
    await orgUpdatedConsumer.disconnect();
    await orgDeletedConsumer.disconnect();
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
