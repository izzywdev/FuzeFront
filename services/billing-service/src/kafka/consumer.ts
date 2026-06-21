import {
  TypedConsumer,
  TypedProducer,
  TOPICS,
  billingUsageRecordedSchemaV1,
  BillingUsageRecordedPayloadV1,
  FuzeEvent,
} from '@fuzefront/shared';
import { MeteringService } from '../services/metering.service';

/**
 * Wires the shared TypedConsumer to buffer billing.usage.recorded events into
 * the metering service. The FuzeEvent envelope's correlationId is the Stripe
 * idempotency identifier, so we thread it into the buffered usage event.
 */
export async function startUsageConsumer(
  consumer: TypedConsumer,
  metering: MeteringService,
  dlqProducer?: TypedProducer,
): Promise<void> {
  await consumer.connect();
  await consumer.subscribe(TOPICS.BILLING_USAGE_RECORDED);
  await consumer.run<BillingUsageRecordedPayloadV1>(
    async (event: FuzeEvent<BillingUsageRecordedPayloadV1>) => {
      await metering.record({
        entityId: event.payload.entityId,
        meterEventName: event.payload.meterEventName,
        quantity: event.payload.quantity,
        occurredAt: event.payload.occurredAt,
        correlationId: event.correlationId,
      });
    },
    billingUsageRecordedSchemaV1,
    dlqProducer,
  );
}
