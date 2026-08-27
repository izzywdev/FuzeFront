import {
  TypedConsumer,
  TypedProducer,
  TOPICS,
  identityOrgDeletedSchemaV1,
  IdentityOrgDeletedPayloadV1,
  FuzeEvent,
} from '@fuzefront/shared/kafka';
import {
  handleOrgDeleted,
  OrgDeletedHandlerDeps,
} from './org-deleted.handler';

/**
 * Wires a TypedConsumer to react to `identity.org.deleted` by canceling the
 * org's Stripe subscription (see handleOrgDeleted). A handler failure
 * dead-letters via the shared DLQ producer (TypedConsumer.run routes
 * schema-invalid/handler-failed messages to `<topic>.dlq`), so the offset still
 * commits and the loop stays healthy.
 */
export async function startOrgDeletedConsumer(
  consumer: TypedConsumer,
  deps: OrgDeletedHandlerDeps,
  dlqProducer?: TypedProducer,
): Promise<void> {
  await consumer.connect();
  await consumer.subscribe(TOPICS.IDENTITY_ORG_DELETED);
  await consumer.run<IdentityOrgDeletedPayloadV1>(
    (event: FuzeEvent<IdentityOrgDeletedPayloadV1>) => handleOrgDeleted(event, deps),
    identityOrgDeletedSchemaV1,
    dlqProducer,
  );
}
