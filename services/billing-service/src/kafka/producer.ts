import {
  TypedProducer,
  TOPICS,
  billingSubscriptionChangedSchemaV1,
  BillingSubscriptionChangedPayloadV1,
  billingPaymentCompletedSchemaV1,
  BillingPaymentCompletedPayloadV1,
  billingTrialEndingSchemaV1,
  BillingTrialEndingPayloadV1,
  billingPaymentFailedSchemaV1,
  BillingPaymentFailedPayloadV1,
  billingTenantRegisteredSchemaV1,
  BillingTenantRegisteredPayloadV1,
  billingPaymentMethodUpdatedSchemaV1,
  BillingPaymentMethodUpdatedPayloadV1,
} from '@fuzefront/shared/kafka';
import { randomUUID } from 'crypto';

/**
 * Thin convenience wrapper over the shared TypedProducer for the billing
 * events this service emits. Defined as an interface so handlers can be
 * unit-tested with a stub emitter (no Kafka broker required).
 */
export interface BillingEventEmitter {
  subscriptionChanged(payload: BillingSubscriptionChangedPayloadV1, correlationId?: string): Promise<void>;
  /** One-time payment-mode Checkout outcome (paid / failed / expired). */
  paymentCompleted(payload: BillingPaymentCompletedPayloadV1, correlationId?: string): Promise<void>;
  /** Fires 3–7 days before a trial expires. */
  trialEnding(payload: BillingTrialEndingPayloadV1, correlationId?: string): Promise<void>;
  /** Fires when Stripe cannot collect payment on an invoice. */
  paymentFailed(payload: BillingPaymentFailedPayloadV1, correlationId?: string): Promise<void>;
  /** A new organization Stripe Customer was created — a new corporate tenant. */
  tenantRegistered(payload: BillingTenantRegisteredPayloadV1, correlationId?: string): Promise<void>;
  /** A payment method was attached/updated on an existing Stripe Customer. */
  paymentMethodUpdated(payload: BillingPaymentMethodUpdatedPayloadV1, correlationId?: string): Promise<void>;
}

// Re-export shared payload types so callers import from a single location.
export type { BillingTrialEndingPayloadV1 as TrialEndingPayload };
export type { BillingPaymentFailedPayloadV1 as PaymentFailedPayload };

export class KafkaBillingEmitter implements BillingEventEmitter {
  constructor(private readonly producer: Pick<TypedProducer, 'send'>) {}

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

  async paymentCompleted(
    payload: BillingPaymentCompletedPayloadV1,
    correlationId = randomUUID(),
  ): Promise<void> {
    await this.producer.send(
      TOPICS.BILLING_PAYMENT_COMPLETED,
      {
        version: '1.0',
        topic: TOPICS.BILLING_PAYMENT_COMPLETED,
        correlationId,
        occurredAt: new Date().toISOString(),
        payload,
      },
      billingPaymentCompletedSchemaV1,
    );
  }

  async trialEnding(payload: BillingTrialEndingPayloadV1, correlationId = randomUUID()): Promise<void> {
    await this.producer.send(
      TOPICS.BILLING_TRIAL_ENDING,
      {
        version: '1.0',
        topic: TOPICS.BILLING_TRIAL_ENDING,
        correlationId,
        occurredAt: new Date().toISOString(),
        payload,
      },
      billingTrialEndingSchemaV1,
    );
  }

  async paymentFailed(payload: BillingPaymentFailedPayloadV1, correlationId = randomUUID()): Promise<void> {
    await this.producer.send(
      TOPICS.BILLING_PAYMENT_FAILED,
      {
        version: '1.0',
        topic: TOPICS.BILLING_PAYMENT_FAILED,
        correlationId,
        occurredAt: new Date().toISOString(),
        payload,
      },
      billingPaymentFailedSchemaV1,
    );
  }

  async tenantRegistered(
    payload: BillingTenantRegisteredPayloadV1,
    correlationId = randomUUID(),
  ): Promise<void> {
    await this.producer.send(
      TOPICS.BILLING_TENANT_REGISTERED,
      {
        version: '1.0',
        topic: TOPICS.BILLING_TENANT_REGISTERED,
        correlationId,
        occurredAt: new Date().toISOString(),
        payload,
      },
      billingTenantRegisteredSchemaV1,
    );
  }

  async paymentMethodUpdated(
    payload: BillingPaymentMethodUpdatedPayloadV1,
    correlationId = randomUUID(),
  ): Promise<void> {
    await this.producer.send(
      TOPICS.BILLING_PAYMENT_METHOD_UPDATED,
      {
        version: '1.0',
        topic: TOPICS.BILLING_PAYMENT_METHOD_UPDATED,
        correlationId,
        occurredAt: new Date().toISOString(),
        payload,
      },
      billingPaymentMethodUpdatedSchemaV1,
    );
  }
}
