// Outbox relay wiring for security-service.
//
// The generic drain loop lives in @fuzeone/core (startOutboxRelay); this
// module injects the Kafka transport: it maps each topic to its frozen Zod
// schema, derives the partition key (entity id) for per-entity ordering, and
// dead-letters rows that exhaust their retries. One relay per shared DB drains
// the `event_outbox` table written transactionally by the route handlers.
import {
  createKafkaClient,
  TypedProducer,
  FuzeEvent,
  dlqTopic,
  TOPICS,
  identityUserCreatedSchemaV1,
  identityUserUpdatedSchemaV1,
  identityUserDeletedSchemaV1,
  identityOrgCreatedSchemaV1,
  identityOrgUpdatedSchemaV1,
  identityOrgDeletedSchemaV1,
  identityMembershipAddedSchemaV1,
  identityMembershipRemovedSchemaV1,
  notifyEmailRequestedSchemaV1,
  portalCreatedSchemaV1,
} from '@fuzeone/shared/kafka'
import {
  db,
  startOutboxRelay,
  OutboxRecord,
  OutboxRelayHandle,
} from '@fuzeone/core'
import type { ZodSchema } from 'zod'

// Topic -> payload schema. Publishing validates against the frozen schema; an
// unmapped topic is published WITHOUT validation (raw) so a newly-emitted topic
// never gets its rows stuck 'pending' before its schema is added here.
const SCHEMA_BY_TOPIC: Record<string, ZodSchema<any>> = {
  [TOPICS.IDENTITY_USER_CREATED]: identityUserCreatedSchemaV1,
  [TOPICS.IDENTITY_USER_UPDATED]: identityUserUpdatedSchemaV1,
  [TOPICS.IDENTITY_USER_DELETED]: identityUserDeletedSchemaV1,
  [TOPICS.IDENTITY_ORG_CREATED]: identityOrgCreatedSchemaV1,
  [TOPICS.IDENTITY_ORG_UPDATED]: identityOrgUpdatedSchemaV1,
  [TOPICS.IDENTITY_ORG_DELETED]: identityOrgDeletedSchemaV1,
  [TOPICS.IDENTITY_MEMBERSHIP_ADDED]: identityMembershipAddedSchemaV1,
  [TOPICS.IDENTITY_MEMBERSHIP_REMOVED]: identityMembershipRemovedSchemaV1,
  [TOPICS.NOTIFY_EMAIL_REQUESTED]: notifyEmailRequestedSchemaV1,
  [TOPICS.PORTAL_CREATED]: portalCreatedSchemaV1,
}

// Kafka message key = entity id, so all events for one org/user land on a
// single partition and stay ordered.
function partitionKey(payload: any): string | undefined {
  return (
    payload?.organizationId ??
    payload?.userId ??
    payload?.portalId ??
    payload?.entityId ??
    undefined
  )
}

let producer: TypedProducer | null = null
async function getProducer(): Promise<TypedProducer> {
  if (producer) return producer
  const brokers = (process.env.KAFKA_BROKERS as string)
    .split(',')
    .map(b => b.trim())
    .filter(Boolean)
  const kafka = createKafkaClient({
    clientId: process.env.KAFKA_CLIENT_ID || 'fuzefront-outbox-relay',
    brokers,
  })
  const p = new TypedProducer(kafka)
  await p.connect()
  producer = p
  return p
}

/**
 * Start the transactional-outbox relay if a Kafka broker is configured. Returns
 * a handle, or null when KAFKA_BROKERS is unset — then events stay durably in
 * `event_outbox` (and reconcile-on-login still provisions), exactly as before.
 */
export function startOutboxRelayIfConfigured(): OutboxRelayHandle | null {
  if (!process.env.KAFKA_BROKERS) {
    console.log(
      'ℹ️ KAFKA_BROKERS unset — outbox relay disabled (events held in event_outbox)'
    )
    return null
  }

  const publish = async (record: OutboxRecord): Promise<void> => {
    // A connect/send failure throws → the row stays 'pending' and is retried.
    const p = await getProducer()
    const event: FuzeEvent<unknown> = {
      version: '1.0',
      topic: record.topic as FuzeEvent['topic'],
      correlationId: record.correlationId,
      occurredAt: new Date().toISOString(),
      payload: record.payload,
    }
    const key = partitionKey(record.payload)
    const schema = SCHEMA_BY_TOPIC[record.topic]
    if (schema) {
      await p.send(record.topic, event, schema, { key })
    } else {
      await p.raw.send({
        topic: record.topic,
        messages: [{ key, value: JSON.stringify(event) }],
      })
    }
  }

  const onDeadLetter = async (record: OutboxRecord): Promise<void> => {
    const p = await getProducer()
    await p.raw.send({
      topic: dlqTopic(record.topic),
      messages: [
        {
          value: JSON.stringify({
            raw: record,
            reason: 'outbox max attempts exhausted',
          }),
        },
      ],
    })
  }

  console.log('🚀 Starting outbox relay (event_outbox → Kafka)')
  return startOutboxRelay({
    db,
    publish,
    onDeadLetter,
    intervalMs: Number(process.env.OUTBOX_RELAY_INTERVAL_MS || 1000),
    logger: {
      info: m => console.log(`[outbox-relay] ${m}`),
      error: m => console.error(`[outbox-relay] ${m}`),
    },
  })
}
