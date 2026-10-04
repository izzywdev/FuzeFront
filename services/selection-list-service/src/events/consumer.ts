import { z } from 'zod';
import {
  dlqTopic,
  identityOrgCreatedSchemaV1,
  IdentityOrgCreatedPayloadV1,
  TypedConsumer,
  TypedProducer,
  createKafkaClient,
  TOPICS,
  identityOrgUpdatedSchemaV1,
  IdentityOrgUpdatedPayloadV1,
  identityOrgDeletedSchemaV1,
  IdentityOrgDeletedPayloadV1,
  identityUserDeletedSchemaV1,
  IdentityUserDeletedPayloadV1,
  FuzeEvent,
} from '@fuzefront/shared/kafka';
import { handleOrgDeleted } from './org-deleted.handler';
import { handleUserDeleted } from './user-deleted.handler';
import { handleOrgCreated } from './org-created.handler';
import { handleOrgUpdated } from './org-updated.handler';
import { handleSeedRequested } from './seed-requested.handler';

interface LifecycleConsumers {
  orgCreated: TypedConsumer;
  orgUpdated: TypedConsumer;
  seedRequested: TypedConsumer;
  orgDeleted: TypedConsumer;
  userDeleted: TypedConsumer;
  dlqProducer: TypedProducer;
  disconnect: () => Promise<void>;
}

/**
 * Starts Kafka consumers for user and organization lifecycle events.
 *
 * Consumer groups (`${KAFKA_GROUP_ID}-<name>`):
 *   selection-list-service-group-org-created     identity.org.created           (projection + platform seeding)
 *   selection-list-service-group-org-updated     identity.org.updated           (projection refresh: type / is_active / name; flag-independent)
 *   selection-list-service-group-seed-requested  selection-lists.seed.requested (app seeding, attested)
 *   selection-list-service-group-org-deleted
 *   selection-list-service-group-user-deleted
 *
 * All share a single DLQ producer. The two seeding consumers are ALWAYS started when Kafka is
 * configured; the seeding flag (`fuzefront.selection-lists.seed-defaults`) is evaluated per
 * message inside the handlers (OFF: the org is still projected / the request is answered
 * SEEDING_DISABLED), never by (not) starting a consumer.
 *
 * `selection-lists.seed.requested` is consumed with a PASSTHROUGH schema: the handler itself
 * schema-parses so a payload that is valid JSON but fails the schema also gets a best-effort
 * `seed.failed` / VALIDATION_ERROR before it is dead-lettered (with the attestation token
 * redacted). Non-JSON still goes straight to the DLQ via TypedConsumer.
 * A message that is not valid JSON or fails
 * schema validation is dead-lettered to `<topic>.dlq` by TypedConsumer (shared/
 * src/kafka/consumer.ts) so the offset still commits. A HANDLER that throws is
 * NOT dead-lettered: the error propagates to kafkajs (retry / consumer restart),
 * which is why a handler bug (see org-deleted.handler.ts) is loud rather than
 * silently parked. On success the DLQ is never touched.
 *
 * Returns a `disconnect()` function for graceful shutdown on SIGTERM.
 */
export async function startLifecycleConsumers(): Promise<LifecycleConsumers> {
  const brokers = (process.env.KAFKA_BROKERS || 'kafka.fuzeinfra.svc.cluster.local:9092').split(',');
  const clientId = 'selection-list-service';
  const baseGroupId = process.env.KAFKA_GROUP_ID || 'selection-list-service-group';

  const kafka = createKafkaClient({ clientId, brokers });

  const dlqProducer = new TypedProducer(kafka);
  await dlqProducer.connect();

  const orgCreatedConsumer = new TypedConsumer(kafka, `${baseGroupId}-org-created`);
  await orgCreatedConsumer.connect();
  await orgCreatedConsumer.subscribe(TOPICS.IDENTITY_ORG_CREATED);
  await orgCreatedConsumer.run<IdentityOrgCreatedPayloadV1>(
    async (event: FuzeEvent<IdentityOrgCreatedPayloadV1>) => {
      await handleOrgCreated(event);
    },
    identityOrgCreatedSchemaV1,
    dlqProducer,
  );

  // Projection refresh only (type / is_active / name): never flagged, never seeds. A payload that fails
  // identityOrgUpdatedSchemaV1 is dead-lettered by TypedConsumer to `identity.org.updated.dlq`.
  const orgUpdatedConsumer = new TypedConsumer(kafka, `${baseGroupId}-org-updated`);
  await orgUpdatedConsumer.connect();
  await orgUpdatedConsumer.subscribe(TOPICS.IDENTITY_ORG_UPDATED);
  await orgUpdatedConsumer.run<IdentityOrgUpdatedPayloadV1>(
    async (event: FuzeEvent<IdentityOrgUpdatedPayloadV1>) => {
      await handleOrgUpdated(event);
    },
    identityOrgUpdatedSchemaV1,
    dlqProducer,
  );

  const seedRequestedConsumer = new TypedConsumer(kafka, `${baseGroupId}-seed-requested`);
  await seedRequestedConsumer.connect();
  await seedRequestedConsumer.subscribe(TOPICS.SELECTION_LISTS_SEED_REQUESTED);
  await seedRequestedConsumer.run<unknown>(
    async (event: FuzeEvent<unknown>) => {
      await handleSeedRequested(event, {
        // Same envelope as TypedConsumer's own dead-letter (the token is already redacted).
        deadLetter: async (topic, redactedEnvelope, reason) => {
          await dlqProducer.raw.send({
            topic: dlqTopic(topic),
            messages: [{ value: JSON.stringify({ raw: JSON.stringify(redactedEnvelope), reason, sourceTopic: topic }) }],
          });
        },
      });
    },
    z.unknown(),
    dlqProducer,
  );

  const orgDeletedConsumer = new TypedConsumer(kafka, `${baseGroupId}-org-deleted`);
  await orgDeletedConsumer.connect();
  await orgDeletedConsumer.subscribe(TOPICS.IDENTITY_ORG_DELETED);
  await orgDeletedConsumer.run<IdentityOrgDeletedPayloadV1>(
    (event: FuzeEvent<IdentityOrgDeletedPayloadV1>) => handleOrgDeleted(event),
    identityOrgDeletedSchemaV1,
    dlqProducer,
  );

  const userDeletedConsumer = new TypedConsumer(kafka, `${baseGroupId}-user-deleted`);
  await userDeletedConsumer.connect();
  await userDeletedConsumer.subscribe(TOPICS.IDENTITY_USER_DELETED);
  await userDeletedConsumer.run<IdentityUserDeletedPayloadV1>(
    (event: FuzeEvent<IdentityUserDeletedPayloadV1>) => handleUserDeleted(event),
    identityUserDeletedSchemaV1,
    dlqProducer,
  );

  const disconnect = async (): Promise<void> => {
    await Promise.all([
      orgCreatedConsumer.disconnect(),
      orgUpdatedConsumer.disconnect(),
      seedRequestedConsumer.disconnect(),
      orgDeletedConsumer.disconnect(),
      userDeletedConsumer.disconnect(),
    ]);
    await dlqProducer.disconnect();
  };

  return {
    orgCreated: orgCreatedConsumer,
    orgUpdated: orgUpdatedConsumer,
    seedRequested: seedRequestedConsumer,
    orgDeleted: orgDeletedConsumer,
    userDeleted: userDeletedConsumer,
    dlqProducer,
    disconnect,
  };
}
