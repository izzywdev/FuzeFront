import {
  createKafkaClient,
  TypedConsumer,
  TOPICS,
  billingSubscriptionChangedSchemaV1,
  BillingSubscriptionChangedPayloadV1,
} from '@fuzefront/shared/kafka'
import { db } from '../config/database'

/**
 * Backend plan-state projection.
 *
 * Per the per-service-DB boundary, billing-service owns ONLY the `billing`
 * schema and never writes the platform's public.users / public.organizations
 * tables. Instead it emits `billing.subscription.changed`; the backend (which
 * owns the public schema) consumes that event here and projects the plan-state
 * hot-path cache columns onto the right entity.
 *
 * Entities are referenced by `(entityType, entityId)` only — the event carries
 * both, and `entityId` is the primary key of the `users` / `organizations`
 * row.
 *
 * Degrades gracefully: when KAFKA_BROKERS is unset the projection is a no-op
 * (the columns simply stay at their migration defaults), matching how the rest
 * of the backend tolerates a missing broker.
 */

let consumer: TypedConsumer | null = null

function kafkaEnabled(): boolean {
  return !!process.env.KAFKA_BROKERS
}

/**
 * Applies a single subscription-changed payload to the public projection.
 * Exported for unit testing without a broker. Returns the number of rows
 * updated (0 when the entity is unknown).
 */
export async function applySubscriptionChanged(
  payload: BillingSubscriptionChangedPayloadV1
): Promise<number> {
  const table = payload.entityType === 'user' ? 'users' : 'organizations'
  const updated = await db(table)
    .where({ id: payload.entityId })
    .update({
      billing_plan_tier: payload.planTier,
      billing_plan_status: payload.status,
    })
  return updated
}

/**
 * Starts the background consumer. Safe to call once at server startup; returns
 * immediately (no-op) when Kafka is disabled. Never throws into the caller —
 * a broker failure must not take down the API.
 */
export async function startBillingProjection(): Promise<void> {
  if (!kafkaEnabled()) {
    console.log(
      'ℹ️ Kafka disabled — billing plan-state projection not started (KAFKA_BROKERS unset)'
    )
    return
  }

  try {
    const brokers = (process.env.KAFKA_BROKERS as string)
      .split(',')
      .map(b => b.trim())
      .filter(Boolean)
    const kafka = createKafkaClient({
      clientId: process.env.KAFKA_CLIENT_ID || 'fuzefront-backend',
      brokers,
    })
    consumer = new TypedConsumer(
      kafka,
      process.env.KAFKA_GROUP_ID || 'fuzefront-backend-billing-projection'
    )
    await consumer.connect()
    await consumer.subscribe(TOPICS.BILLING_SUBSCRIPTION_CHANGED)
    // Run the loop in the background; the handler projects each event.
    void consumer.run(async event => {
      try {
        const rows = await applySubscriptionChanged(event.payload)
        if (rows === 0) {
          console.warn(
            `[billing-projection] no ${event.payload.entityType} row for ${event.payload.entityId}`
          )
        }
      } catch (err) {
        console.error('[billing-projection] failed to apply event:', err)
      }
    }, billingSubscriptionChangedSchemaV1)
    console.log(
      `📥 Billing plan-state projection consuming ${TOPICS.BILLING_SUBSCRIPTION_CHANGED}`
    )
  } catch (err) {
    console.error(
      '⚠️ Failed to start billing plan-state projection (continuing without it):',
      err
    )
  }
}

/** Disconnect the projection consumer (graceful shutdown). */
export async function stopBillingProjection(): Promise<void> {
  if (consumer) {
    try {
      await consumer.disconnect()
    } finally {
      consumer = null
    }
  }
}
