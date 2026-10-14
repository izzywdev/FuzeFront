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
  IdentityUserUpdatedPayloadV1,
  identityUserUpdatedSchemaV1,
  IdentityUserDeletedPayloadV1,
  identityUserDeletedSchemaV1,
  IdentityMembershipAddedPayloadV1,
  identityMembershipAddedSchemaV1,
  IdentityMembershipRemovedPayloadV1,
  identityMembershipRemovedSchemaV1,
} from '@fuzefront/shared/kafka';
import { loadConfig } from './config';
import {
  handleUserCreated,
  handleOrgCreated,
  handleOrgUpdated,
  handleOrgDeleted,
  handleUserUpdated,
  handleUserDeleted,
  handleMembershipAdded,
  handleMembershipRemoved,
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

  // identity.user.updated -> re-sync the user's profile into Permit.
  const userUpdatedConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-user-updated`);
  await userUpdatedConsumer.connect();
  await userUpdatedConsumer.subscribe(TOPICS.IDENTITY_USER_UPDATED);
  await userUpdatedConsumer.run(
    withDlq<IdentityUserUpdatedPayloadV1>(TOPICS.IDENTITY_USER_UPDATED, event =>
      handleUserUpdated(event, handlerDeps)
    ),
    identityUserUpdatedSchemaV1,
    dlqProducer
  );

  // identity.user.deleted -> tear down the user's Permit principal + sessions.
  const userDeletedConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-user-deleted`);
  await userDeletedConsumer.connect();
  await userDeletedConsumer.subscribe(TOPICS.IDENTITY_USER_DELETED);
  await userDeletedConsumer.run(
    withDlq<IdentityUserDeletedPayloadV1>(TOPICS.IDENTITY_USER_DELETED, event =>
      handleUserDeleted(event, handlerDeps)
    ),
    identityUserDeletedSchemaV1,
    dlqProducer
  );

  // identity.membership.added -> assign the member's Permit role.
  const membershipAddedConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-membership-added`);
  await membershipAddedConsumer.connect();
  await membershipAddedConsumer.subscribe(TOPICS.IDENTITY_MEMBERSHIP_ADDED);
  await membershipAddedConsumer.run(
    withDlq<IdentityMembershipAddedPayloadV1>(TOPICS.IDENTITY_MEMBERSHIP_ADDED, event =>
      handleMembershipAdded(event, handlerDeps)
    ),
    identityMembershipAddedSchemaV1,
    dlqProducer
  );

  // identity.membership.removed -> revoke the member's Permit role.
  const membershipRemovedConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-membership-removed`);
  await membershipRemovedConsumer.connect();
  await membershipRemovedConsumer.subscribe(TOPICS.IDENTITY_MEMBERSHIP_REMOVED);
  await membershipRemovedConsumer.run(
    withDlq<IdentityMembershipRemovedPayloadV1>(TOPICS.IDENTITY_MEMBERSHIP_REMOVED, event =>
      handleMembershipRemoved(event, handlerDeps)
    ),
    identityMembershipRemovedSchemaV1,
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
    await userUpdatedConsumer.disconnect();
    await userDeletedConsumer.disconnect();
    await membershipAddedConsumer.disconnect();
    await membershipRemovedConsumer.disconnect();
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
