import { Pool } from 'pg';
import {
  TypedConsumer,
  TypedProducer,
  createKafkaClient,
  TOPICS,
  identityOrgDeletedSchemaV1,
  IdentityOrgDeletedPayloadV1,
  identityUserDeletedSchemaV1,
  IdentityUserDeletedPayloadV1,
  FuzeEvent,
} from '@fuzefront/shared/kafka';
import { handleOrgDeleted } from './org-deleted.handler';
import { handleUserDeleted } from './user-deleted.handler';

export interface LifecycleConsumers {
  disconnect: () => Promise<void>;
}

/**
 * Starts the identity lifecycle consumers, so a deleted organization or user
 * does not leave its config overrides behind forever.
 *
 * Mirrors selection-list-service/src/events/consumer.ts deliberately — one
 * consumer GROUP per topic (so a poison message on one topic cannot stall the
 * other), a shared DLQ producer, and a `disconnect()` for graceful SIGTERM
 * shutdown. `TypedConsumer.run` validates each message against the registered
 * zod schema and dead-letters a handler failure to `<topic>.dlq`, so the offset
 * still commits and the consumer loop stays healthy instead of hot-looping on
 * one bad row.
 *
 * Consumer groups:
 *   config-service-group-org-deleted
 *   config-service-group-user-deleted
 *
 * Returns `null` when KAFKA_BROKERS is unset, rather than defaulting to a
 * broker address. config-service runs in environments (CI, local `npm run dev`,
 * the DATABASE_URL-less /health-only mode in index.ts) where no broker exists,
 * and a consumer that retries a connection forever there is noise that buries
 * real failures. The caller logs the skip.
 */
export async function startLifecycleConsumers(pool: Pool): Promise<LifecycleConsumers | null> {
  const brokersRaw = process.env.KAFKA_BROKERS;
  if (!brokersRaw) {
    return null;
  }

  const brokers = brokersRaw.split(',').map((b) => b.trim()).filter(Boolean);
  if (brokers.length === 0) {
    return null;
  }

  const clientId = 'config-service';
  const baseGroupId = process.env.KAFKA_GROUP_ID || 'config-service-group';

  const kafka = createKafkaClient({ clientId, brokers });

  const dlqProducer = new TypedProducer(kafka);
  await dlqProducer.connect();

  const orgDeletedConsumer = new TypedConsumer(kafka, `${baseGroupId}-org-deleted`);
  await orgDeletedConsumer.connect();
  await orgDeletedConsumer.subscribe(TOPICS.IDENTITY_ORG_DELETED);
  await orgDeletedConsumer.run<IdentityOrgDeletedPayloadV1>(
    (event: FuzeEvent<IdentityOrgDeletedPayloadV1>) => handleOrgDeleted(pool, event),
    identityOrgDeletedSchemaV1,
    dlqProducer,
  );

  const userDeletedConsumer = new TypedConsumer(kafka, `${baseGroupId}-user-deleted`);
  await userDeletedConsumer.connect();
  await userDeletedConsumer.subscribe(TOPICS.IDENTITY_USER_DELETED);
  await userDeletedConsumer.run<IdentityUserDeletedPayloadV1>(
    (event: FuzeEvent<IdentityUserDeletedPayloadV1>) => handleUserDeleted(pool, event),
    identityUserDeletedSchemaV1,
    dlqProducer,
  );

  const disconnect = async (): Promise<void> => {
    await Promise.all([orgDeletedConsumer.disconnect(), userDeletedConsumer.disconnect()]);
    await dlqProducer.disconnect();
  };

  return { disconnect };
}
