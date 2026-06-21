import {
  TypedProducer,
  TOPICS,
  billingSubscriptionChangedSchemaV1,
  BillingSubscriptionChangedPayloadV1,
} from '@fuzefront/shared';
import { randomUUID } from 'crypto';

/**
 * Thin convenience wrapper over the shared TypedProducer for the billing
 * events this service emits. Defined as an interface so handlers can be
 * unit-tested with a stub emitter (no Kafka broker required).
 */
export interface BillingEventEmitter {
  subscriptionChanged(payload: BillingSubscriptionChangedPayloadV1, correlationId?: string): Promise<void>;
  /** trial-ending + payment-failed carry the same lightweight notify shape. */
  trialEnding(payload: TrialEndingPayload, correlationId?: string): Promise<void>;
  paymentFailed(payload: PaymentFailedPayload, correlationId?: string): Promise<void>;
}

export interface TrialEndingPayload {
  entityId: string;
  entityType: 'user' | 'organization';
  trialEnd: string;
  planTier: string;
}

export interface PaymentFailedPayload {
  entityId: string;
  entityType: 'user' | 'organization';
  invoiceId: string;
  amountDue: number;
  currency: string;
}

export class KafkaBillingEmitter implements BillingEventEmitter {
  constructor(private readonly producer: Pick<TypedProducer, 'send' | 'raw'>) {}

  async subscriptionChanged(
    payload: BillingSubscriptionChangedPayloadV1,
    correlationId = randomUUID(),
  ): Promise<void> {
    await this.producer.send(
      TOPICS.BILLING_SUBSCRIPTION_CHANGED,
      {
        version: '1.0',
        topic: TOPICS.BILLING_SUBSCRIPTION_CHANGED,
        correlationId,
        occurredAt: new Date().toISOString(),
        payload,
      },
      billingSubscriptionChangedSchemaV1,
    );
  }

  async trialEnding(payload: TrialEndingPayload, correlationId = randomUUID()): Promise<void> {
    // No dedicated shared schema yet; emit a raw envelope on the trial topic.
    await this.producer.raw.send({
      topic: TOPICS.BILLING_TRIAL_ENDING,
      messages: [
        {
          value: JSON.stringify({
            version: '1.0',
            topic: TOPICS.BILLING_TRIAL_ENDING,
            correlationId,
            occurredAt: new Date().toISOString(),
            payload,
          }),
        },
      ],
    });
  }

  async paymentFailed(payload: PaymentFailedPayload, correlationId = randomUUID()): Promise<void> {
    await this.producer.raw.send({
      topic: TOPICS.BILLING_PAYMENT_FAILED,
      messages: [
        {
          value: JSON.stringify({
            version: '1.0',
            topic: TOPICS.BILLING_PAYMENT_FAILED,
            correlationId,
            occurredAt: new Date().toISOString(),
            payload,
          }),
        },
      ],
    });
  }
}
