import {
  createKafkaClient,
  TypedProducer,
  TOPICS,
  FuzeEvent,
  identityUserCreatedSchemaV1,
  IdentityUserCreatedPayloadV1,
  notifyEmailRequestedSchemaV1,
  NotifyEmailRequestedPayloadV1,
} from '@fuzefront/shared/kafka'

/**
 * Thin, injectable Kafka publish surface used by provisioning.
 *
 * Tests pass a fake implementing `EventPublisher` so nothing touches a real
 * broker. In production a lazily-connected shared `TypedProducer` is used.
 * When `KAFKA_BROKERS` is unset the publisher is a logging no-op so the backend
 * still runs (and provisioning still completes) without Kafka — events are also
 * recorded in `event_outbox`, so a later drainer can replay them.
 */
export interface EventPublisher {
  publishIdentityUserCreated(
    payload: IdentityUserCreatedPayloadV1,
    correlationId: string
  ): Promise<void>
  publishNotifyEmailRequested(
    payload: NotifyEmailRequestedPayloadV1,
    correlationId: string
  ): Promise<void>
}

let producer: TypedProducer | null = null
let connecting: Promise<TypedProducer | null> | null = null

function kafkaEnabled(): boolean {
  return !!process.env.KAFKA_BROKERS
}

async function getProducer(): Promise<TypedProducer | null> {
  if (!kafkaEnabled()) return null
  if (producer) return producer
  if (!connecting) {
    connecting = (async () => {
      const brokers = (process.env.KAFKA_BROKERS as string)
        .split(',')
        .map(b => b.trim())
        .filter(Boolean)
      const kafka = createKafkaClient({
        clientId: process.env.KAFKA_CLIENT_ID || 'fuzefront-backend',
        brokers,
      })
      const p = new TypedProducer(kafka)
      await p.connect()
      producer = p
      return p
    })().catch(err => {
      // Don't cache a failed connection; allow retry on next publish.
      connecting = null
      console.error('⚠️ Kafka producer connect failed:', err)
      return null
    })
  }
  return connecting
}

function envelope<T>(
  topic: (typeof TOPICS)[keyof typeof TOPICS],
  payload: T,
  correlationId: string
): FuzeEvent<T> {
  return {
    version: '1.0',
    topic,
    correlationId,
    occurredAt: new Date().toISOString(),
    payload,
  }
}

export const defaultEventPublisher: EventPublisher = {
  async publishIdentityUserCreated(payload, correlationId) {
    const p = await getProducer()
    if (!p) {
      console.log(
        `ℹ️ Kafka disabled — skipping ${TOPICS.IDENTITY_USER_CREATED} publish (outbox holds it)`
      )
      return
    }
    await p.send(
      TOPICS.IDENTITY_USER_CREATED,
      envelope(TOPICS.IDENTITY_USER_CREATED, payload, correlationId),
      identityUserCreatedSchemaV1
    )
  },

  async publishNotifyEmailRequested(payload, correlationId) {
    const p = await getProducer()
    if (!p) {
      console.log(
        `ℹ️ Kafka disabled — skipping ${TOPICS.NOTIFY_EMAIL_REQUESTED} publish (outbox holds it)`
      )
      return
    }
    await p.send(
      TOPICS.NOTIFY_EMAIL_REQUESTED,
      envelope(TOPICS.NOTIFY_EMAIL_REQUESTED, payload, correlationId),
      notifyEmailRequestedSchemaV1
    )
  },
}

/** Disconnect the shared producer (graceful shutdown). */
export async function disconnectEventPublisher(): Promise<void> {
  if (producer) {
    await producer.disconnect()
    producer = null
    connecting = null
  }
}
