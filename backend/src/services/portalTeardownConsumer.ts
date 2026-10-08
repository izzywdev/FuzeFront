import {
  createKafkaClient,
  TypedConsumer,
  TOPICS,
  identityOrgDeletedSchemaV1,
  IdentityOrgDeletedPayloadV1,
} from '@fuzefront/shared/kafka'
import { teardownPortalsForOrg } from './portalTeardown'

/**
 * Backend reaction to `identity.org.deleted` (FFRNT-174): tear down the deleted
 * org's portals (see portalTeardown.ts). Mirrors billingProjection.ts — a
 * background TypedConsumer that degrades to a no-op when KAFKA_BROKERS is unset
 * and never throws into the caller (a broker failure must not take down the
 * API). Its own consumer group so it does not share offsets with the billing
 * projection or ref-index consumers.
 */

let consumer: TypedConsumer | null = null

function kafkaEnabled(): boolean {
  return !!process.env.KAFKA_BROKERS
}

export async function startPortalTeardownConsumer(): Promise<void> {
  if (!kafkaEnabled()) {
    console.log(
      'ℹ️ Kafka disabled — portal-teardown consumer not started (KAFKA_BROKERS unset)'
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
      `${process.env.KAFKA_GROUP_ID || 'fuzefront-backend'}-portal-teardown`
    )
    await consumer.connect()
    await consumer.subscribe(TOPICS.IDENTITY_ORG_DELETED)
    void consumer.run(async (event: { payload: IdentityOrgDeletedPayloadV1 }) => {
      try {
        const result = await teardownPortalsForOrg(
          event.payload.organizationId,
          event.payload.cascade
        )
        console.log(
          `[portal-teardown] org ${event.payload.organizationId} cascade=${event.payload.cascade} portalsAffected=${result.portalsAffected}`
        )
      } catch (err) {
        console.error('[portal-teardown] failed to apply event:', err)
      }
    }, identityOrgDeletedSchemaV1)
    console.log(
      `📥 Portal-teardown consumer consuming ${TOPICS.IDENTITY_ORG_DELETED}`
    )
  } catch (err) {
    console.error(
      '⚠️ Failed to start portal-teardown consumer (continuing without it):',
      err
    )
  }
}

/** Disconnect the portal-teardown consumer (graceful shutdown). */
export async function stopPortalTeardownConsumer(): Promise<void> {
  if (consumer) {
    try {
      await consumer.disconnect()
    } finally {
      consumer = null
    }
  }
}
