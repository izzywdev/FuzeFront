import {
  TypedConsumer,
  TypedProducer,
  TOPICS,
  identityUserDeletedSchemaV1,
  IdentityUserDeletedPayloadV1,
  FuzeEvent,
} from '@fuzefront/shared/kafka';
import {
  handleUserDeleted,
  UserDeletedHandlerDeps,
} from './user-deleted.handler';

/**
 * Wires a TypedConsumer to react to `identity.user.deleted` by canceling any
 * user-scoped Stripe subscription (see handleUserDeleted). Uses its own
 * consumer group so it does not share offsets with the usage, ref-index, or
 * org-deleted consumers.
 */
export async function startUserDeletedConsumer(
  consumer: TypedConsumer,
  deps: UserDeletedHandlerDeps,
  dlqProducer?: TypedProducer,
): Promise<void> {
  await consumer.connect();
  await consumer.subscribe(TOPICS.IDENTITY_USER_DELETED);
  await consumer.run<IdentityUserDeletedPayloadV1>(
    (event: FuzeEvent<IdentityUserDeletedPayloadV1>) => handleUserDeleted(event, deps),
    identityUserDeletedSchemaV1,
    dlqProducer,
  );
}
