import { randomUUID } from 'node:crypto'
import { Kafka } from 'kafkajs'

export interface EventBus {
  publish(topic: string, payload: unknown, key?: string): Promise<void>
}

export class InProcessEventBus implements EventBus {
  readonly events: Array<{ topic: string; payload: unknown; key?: string }> = []

  async publish(topic: string, payload: unknown, key?: string) {
    this.events.push({ topic, payload, key })
  }
}

export class KafkaEventBus implements EventBus {
  private readonly producer

  constructor(brokers: string[], clientId = 'fuzequality-backend') {
    this.producer = new Kafka({ brokers, clientId }).producer()
  }

  async publish(topic: string, payload: unknown, key?: string) {
    await this.producer.connect()
    await this.producer.send({
      topic,
      messages: [
        {
          key,
          value: JSON.stringify({
            version: '1.0',
            topic,
            correlationId: randomUUID(),
            occurredAt: new Date().toISOString(),
            payload,
          }),
        },
      ],
    })
  }
}

export function createEventBus(): EventBus {
  const brokers = process.env.KAFKA_BROKERS?.split(',').filter(Boolean)
  return brokers?.length ? new KafkaEventBus(brokers) : new InProcessEventBus()
}
