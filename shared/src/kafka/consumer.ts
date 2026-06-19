import { Consumer, Kafka } from 'kafkajs';
import { ZodSchema, ZodError } from 'zod';
import { FuzeEvent, dlqTopic } from './types';
import { TypedProducer } from './producer';

export type EventHandler<T> = (event: FuzeEvent<T>) => Promise<void>;

export class TypedConsumer {
  private consumer: Consumer;

  constructor(kafka: Kafka, groupId: string) {
    this.consumer = kafka.consumer({ groupId });
  }

  async connect(): Promise<void> {
    await this.consumer.connect();
  }

  async subscribe(topic: string, fromBeginning = false): Promise<void> {
    await this.consumer.subscribe({ topic, fromBeginning });
  }

  /**
   * Runs the consumer loop.
   * - Deserializes each message as JSON.
   * - Validates the payload with `schema`.
   * - On ZodError or JSON parse failure, emits to the DLQ topic via `dlqProducer`
   *   (if provided) and skips the message so the consumer stays healthy.
   */
  async run<T>(
    handler: EventHandler<T>,
    schema: ZodSchema<T>,
    dlqProducer?: TypedProducer
  ): Promise<void> {
    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        const raw = message.value?.toString();
        if (!raw) return;

        let envelope: FuzeEvent<unknown>;
        try {
          envelope = JSON.parse(raw) as FuzeEvent<unknown>;
        } catch (err) {
          await this.deadLetter(topic, raw, 'JSON parse failure', dlqProducer);
          return;
        }

        let parsed: T;
        try {
          parsed = schema.parse(envelope.payload);
        } catch (err) {
          const msg = err instanceof ZodError ? err.message : String(err);
          await this.deadLetter(topic, raw, msg, dlqProducer);
          return;
        }

        await handler({ ...envelope, payload: parsed });
      },
    });
  }

  async disconnect(): Promise<void> {
    await this.consumer.disconnect();
  }

  private async deadLetter(
    sourceTopic: string,
    raw: string,
    reason: string,
    dlqProducer?: TypedProducer
  ): Promise<void> {
    console.error(`[TypedConsumer] Dead-lettering message from ${sourceTopic}: ${reason}`);
    if (dlqProducer) {
      const dlq = dlqTopic(sourceTopic);
      await dlqProducer.raw.send({
        topic: dlq,
        messages: [{ value: JSON.stringify({ raw, reason, sourceTopic }) }],
      });
    }
  }
}
