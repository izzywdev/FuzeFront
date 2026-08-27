import { z } from 'zod';
import {
  TypedConsumer,
  TypedProducer,
  FuzeEvent,
} from '@fuzefront/shared/kafka';
import {
  applyEventToRefIndex,
  REF_INDEX_TOPICS,
  type RefIndexStore,
} from '@izzywdev/fuzefront-identity';

/**
 * A deliberately permissive envelope schema.
 *
 * The shared TypedConsumer validates every message with ONE schema, but this
 * consumer subscribes to several topics with different payload shapes. Pinning
 * a union of all of them here would mean this consumer breaks whenever any
 * upstream service adds a field — and it would break by dead-lettering
 * lifecycle events, silently rotting the projection.
 *
 * The projection only needs an id (and sometimes a tenant), and
 * `applyEventToRefIndex` already skips any payload that lacks one. So the
 * tolerant read is the correct one: this consumer must never be the reason a
 * valid event is dropped.
 */
const anyPayload = z.record(z.any());

/**
 * Keeps billing.ref_index current from the lifecycle events the owning services
 * already publish (FFRNT-184 / identifier-standard.md §5, layer L1).
 *
 * Restart behaviour — the acceptance criterion "the projection survives and
 * self-heals across a consumer restart" — is two mechanisms, not one:
 *
 *  * ORDINARY restart: the table is durable and the consumer group's committed
 *    offsets are durable, so the consumer resumes where it stopped and the rows
 *    it already wrote are still there. Nothing to rebuild.
 *  * LOST projection (restored from a backup without it, new replica, table
 *    truncated): committed offsets would make the consumer resume from the tip
 *    and never re-observe entities created before the loss — the projection
 *    would look healthy while permanently missing rows. So when the table is
 *    empty we replay from the beginning of each topic and rebuild. Every write
 *    is idempotent, which is what makes a full replay safe rather than a
 *    duplicate-row event.
 */
export async function startRefIndexConsumer(
  consumer: TypedConsumer,
  store: RefIndexStore,
  dlqProducer?: TypedProducer,
): Promise<void> {
  await consumer.connect();

  const rebuilding = await store.isEmpty();
  if (rebuilding) {
    console.log(
      '[billing-service] ref_index is empty — replaying lifecycle topics from the ' +
        'beginning to rebuild the projection',
    );
  }

  for (const topic of REF_INDEX_TOPICS) {
    await consumer.subscribe(topic, rebuilding);
  }

  await consumer.run<Record<string, unknown>>(
    async (event: FuzeEvent<Record<string, unknown>>) => {
      await applyEventToRefIndex(store, event.topic, event.payload);
    },
    anyPayload,
    dlqProducer,
  );
}
