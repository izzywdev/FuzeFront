import { randomUUID } from 'node:crypto'
import { Kafka } from 'kafkajs'
import type { CatalogStore } from './store'

export interface EventBus {
  publish(topic: string, payload: unknown, key?: string, eventId?: string): Promise<void>
}

export class InProcessEventBus implements EventBus {
  readonly events: Array<{ topic: string; payload: unknown; key?: string; eventId?: string }> = []

  async publish(topic: string, payload: unknown, key?: string, eventId?: string) {
    this.events.push({ topic, payload, key, eventId })
  }
}

export class KafkaEventBus implements EventBus {
  private readonly producer

  constructor(brokers: string[], clientId = 'fuzequality-backend') {
    this.producer = new Kafka({ brokers, clientId }).producer()
  }

  async publish(topic: string, payload: unknown, key?: string, eventId?: string) {
    await this.producer.connect()
    await this.producer.send({
      topic,
      messages: [
        {
          key,
          value: JSON.stringify({
            version: '1.0',
            topic,
            correlationId: eventId ?? randomUUID(),
            occurredAt: new Date().toISOString(),
            payload,
          }),
        },
      ],
    })
  }
}

/**
 * Publishes a leased batch using at-least-once delivery. The durable outbox ID
 * is also the event correlation ID, allowing consumers to deduplicate the rare
 * publish-success/process-crash replay.
 */
export async function relayOutboxBatch(store: CatalogStore, bus: EventBus, limit = 100): Promise<number> {
  const pending = await store.claimOutboxEvents(limit)
  const failures: unknown[] = []
  let published = 0
  for (const event of pending) {
    try {
      await bus.publish(event.topic, event.payload, event.key, event.id)
      await store.markOutboxPublished(event.id)
      published += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await store.releaseOutboxEvent(event.id, message)
      failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, `Failed to publish ${failures.length} outbox event(s)`)
  return published
}

export function createEventBus(): EventBus {
  const brokers = process.env.KAFKA_BROKERS?.split(',').filter(Boolean)
  return brokers?.length ? new KafkaEventBus(brokers) : new InProcessEventBus()
}
