import { Producer, Kafka } from 'kafkajs';
import { ZodSchema } from 'zod';
import { FuzeEvent, TopicName, dlqTopic } from './types';

export class TypedProducer {
  private producer: Producer;

  constructor(kafka: Kafka) {
    this.producer = kafka.producer();
  }

  async connect(): Promise<void> {
    await this.producer.connect();
  }

  /**
   * Validates `event.payload` against `schema` then sends the event.
   * Throws ZodError if validation fails (caller should dead-letter).
   */
  async send<T>(
    topic: TopicName | string,
    event: FuzeEvent<T>,
    schema: ZodSchema<T>
  ): Promise<void> {
    schema.parse(event.payload); // throws ZodError on failure
    await this.producer.send({
      topic,
      messages: [{ value: JSON.stringify(event) }],
    });
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }

  /** Expose the raw KafkaJS producer for testing */
  get raw(): Producer {
    return this.producer;
  }
}
