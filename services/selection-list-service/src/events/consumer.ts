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

interface LifecycleConsumers {
  orgDeleted: TypedConsumer;
  userDeleted: TypedConsumer;
  dlqProducer: TypedProducer;
  disconnect: () => Promise<void>;
}

/**
 * Starts Kafka consumers for user and organization lifecycle events.
 *
 * Consumer groups:
 *   selection-list-service-group-org-deleted
 *   selection-list-service-group-user-deleted
 *
 * Both share a single DLQ producer. A handler failure dead-letters the message
 * to `<topic>.dlq` so the offset still commits and the loop stays healthy.
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
    await Promise.all([orgDeletedConsumer.disconnect(), userDeletedConsumer.disconnect()]);
    await dlqProducer.disconnect();
  };

  return { orgDeleted: orgDeletedConsumer, userDeleted: userDeletedConsumer, dlqProducer, disconnect };
}
