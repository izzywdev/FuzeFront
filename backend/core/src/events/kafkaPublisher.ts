import { Knex } from 'knex'
import { ZodSchema } from 'zod'
import {
  createKafkaClient,
  TypedProducer,
  FuzeEvent,
  dlqTopic,
  schemaForTopic,
  partitionKeyForPayload,
} from '@fuzefront/shared/kafka'
import {
  OutboxRecord,
  OutboxRelayHandle,
  startOutboxRelay,
} from './outboxRelay'

export interface KafkaPublisherConfig {
  brokers: string[]
  clientId?: string
}

export interface KafkaOutboxPublisher {
  /** Publish an outbox record to Kafka (validates via the shared schema registry). */
  publish: (record: OutboxRecord) => Promise<void>
  /** Route an exhausted record to its `<topic>.dlq`. */
  deadLetter: (record: OutboxRecord) => Promise<void>
  /** Disconnect the underlying producer (graceful shutdown). */
  disconnect: () => Promise<void>
}

/** Minimal producer surface the publisher needs — satisfied by `TypedProducer`. */
export interface ProducerLike {
  send<T>(
    topic: string,
    event: FuzeEvent<T>,
    schema: ZodSchema<T>,
    options?: { key?: string }
  ): Promise<void>
  raw: { send(payload: { topic: string; messages: Array<{ key?: string; value: string }> }): Promise<unknown> }
  disconnect(): Promise<void>
}

/**
 * The generic transport wiring, decoupled from how the producer is obtained so
 * it is unit-testable with a fake. Builds the `FuzeEvent` envelope, derives the
 * partition key, and validates against the shared schema registry (unmapped
 * topics publish raw). `getProducer` is called lazily/memoised by the caller.
 */
export function makeOutboxPublisher(getProducer: () => Promise<ProducerLike>): KafkaOutboxPublisher {
  const publish = async (record: OutboxRecord): Promise<void> => {
    // A connect/send failure throws → the relay leaves the row 'pending'.
    const p = await getProducer()
    const event: FuzeEvent<unknown> = {
      version: '1.0',
      topic: record.topic as FuzeEvent['topic'],
      correlationId: record.correlationId,
      occurredAt: new Date().toISOString(),
      payload: record.payload,
    }
    const key = partitionKeyForPayload(record.payload)
    const schema = schemaForTopic(record.topic)
    if (schema) {
      await p.send(record.topic, event, schema as ZodSchema<unknown>, { key })
    } else {
      await p.raw.send({
        topic: record.topic,
        messages: [{ key, value: JSON.stringify(event) }],
      })
    }
  }

  const deadLetter = async (record: OutboxRecord): Promise<void> => {
    const p = await getProducer()
    await p.raw.send({
      topic: dlqTopic(record.topic),
      messages: [
        { value: JSON.stringify({ raw: record, reason: 'outbox max attempts exhausted' }) },
      ],
    })
  }

  const disconnect = async (): Promise<void> => {
    // Only disconnect a producer that was actually created.
    const p = await getProducer().catch(() => null)
    if (p) await p.disconnect()
  }

  return { publish, deadLetter, disconnect }
}

/**
 * Builds an outbox publisher backed by a lazily-connected Kafka `TypedProducer`.
 */
export function createKafkaOutboxPublisher(config: KafkaPublisherConfig): KafkaOutboxPublisher {
  let producer: TypedProducer | null = null
  let connecting: Promise<TypedProducer> | null = null

  const getProducer = async (): Promise<ProducerLike> => {
    if (producer) return producer
    if (!connecting) {
      connecting = (async () => {
        const kafka = createKafkaClient({
          clientId: config.clientId || 'fuzefront-outbox-relay',
          brokers: config.brokers,
        })
        const p = new TypedProducer(kafka)
        await p.connect()
        producer = p
        return p
      })().catch(err => {
        connecting = null // don't cache a failed connection
        throw err
      })
    }
    return connecting
  }

  const base = makeOutboxPublisher(getProducer)
  return {
    ...base,
    disconnect: async () => {
      if (producer) {
        await producer.disconnect()
        producer = null
        connecting = null
      }
    },
  }
}

export interface OutboxRelayFromEnvHandle extends OutboxRelayHandle {
  disconnect: () => Promise<void>
}

/**
 * Start the transactional-outbox relay with the Kafka transport wired from the
 * environment — the one-call, install-and-go entry point for any backend
 * service. Returns null (a no-op) when no broker is configured, so events stay
 * durably in `event_outbox` until one is.
 */
export function startOutboxRelayFromEnv(opts: {
  db: Knex
  brokers?: string
  clientId?: string
  intervalMs?: number
  logger?: { info: (m: string) => void; error: (m: string) => void }
}): OutboxRelayFromEnvHandle | null {
  const brokersRaw = opts.brokers ?? process.env.KAFKA_BROKERS
  if (!brokersRaw) {
    opts.logger?.info('KAFKA_BROKERS unset — outbox relay disabled (events held in event_outbox)')
    return null
  }
  const brokers = brokersRaw
    .split(',')
    .map(b => b.trim())
    .filter(Boolean)

  const { publish, deadLetter, disconnect } = createKafkaOutboxPublisher({
    brokers,
    clientId: opts.clientId,
  })

  const handle = startOutboxRelay({
    db: opts.db,
    publish,
    onDeadLetter: deadLetter,
    intervalMs: opts.intervalMs ?? Number(process.env.OUTBOX_RELAY_INTERVAL_MS || 1000),
    logger: opts.logger,
  })

  return { stop: handle.stop, disconnect }
}
