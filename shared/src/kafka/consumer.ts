import { Consumer, Kafka } from 'kafkajs';
import crypto from 'crypto';
import { z, ZodSchema, ZodError } from 'zod';
import { FuzeEvent, dlqTopic } from './types';
import { TypedProducer } from './producer';

export type EventHandler<T> = (event: FuzeEvent<T>) => Promise<void>;

/**
 * The broker topic is the authority for routing.  The envelope's topic is
 * validated separately and must agree with it before a handler can see the
 * event.  This prevents a producer that is allowed to write one topic from
 * smuggling a different event type through a consumer that trusted only the
 * JSON payload.
 *
 * Correlation ids are intentionally strings (rather than UUIDs): historical
 * producers use readable identifiers.  They are still bounded so poison input
 * cannot become an unbounded log/DLQ record.
 */
const eventEnvelopeSchema = z
  .object({
    version: z.string().min(1).max(32),
    topic: z.string().min(1).max(200),
    correlationId: z.string().min(1).max(256),
    occurredAt: z.string().datetime({ offset: true }),
    payload: z.unknown(),
  })
  .strict();

const SENSITIVE_KEY = /(token|secret|password|authorization|cookie|email|first_?name|last_?name)/i;
const MAX_DLQ_RAW_BYTES = 64 * 1024;

/**
 * DLQ records are operational data, not a second copy of the platform's PII
 * store.  Retain enough structured evidence to diagnose and manually replay
 * an event while removing credentials and direct-identifying profile fields.
 * For malformed or oversized input retain only a SHA-256 fingerprint.
 */
export function redactForDlq(raw: string): string {
  if (Buffer.byteLength(raw, 'utf8') > MAX_DLQ_RAW_BYTES) {
    return JSON.stringify({
      raw: '[REDACTED_OVERSIZED]',
      rawSha256: crypto.createHash('sha256').update(raw).digest('hex'),
    });
  }

  try {
    const redact = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(redact);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, child]) => [
            key,
            SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(child),
          ])
        );
      }
      return value;
    };
    return JSON.stringify(redact(JSON.parse(raw)));
  } catch {
    return JSON.stringify({
      raw: '[REDACTED_UNPARSEABLE]',
      rawSha256: crypto.createHash('sha256').update(raw).digest('hex'),
    });
  }
}

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

        let envelope: z.infer<typeof eventEnvelopeSchema>;
        try {
          envelope = eventEnvelopeSchema.parse(JSON.parse(raw));
        } catch (err) {
          const reason = err instanceof ZodError ? `Envelope validation failure: ${err.message}` : 'JSON parse failure';
          await this.deadLetter(topic, raw, reason, dlqProducer);
          return;
        }

        if (envelope.topic !== topic) {
          await this.deadLetter(topic, raw, 'Envelope topic does not match Kafka topic', dlqProducer);
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

        await handler({ ...envelope, payload: parsed } as FuzeEvent<T>);
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
        messages: [{ value: JSON.stringify({ raw: redactForDlq(raw), reason, sourceTopic }) }],
      });
    }
  }
}
