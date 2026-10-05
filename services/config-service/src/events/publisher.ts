import { randomUUID } from 'crypto';
import {
  TOPICS,
  TypedProducer,
  createKafkaClient,
  configChangedSchemaV1,
  ConfigChangedPayloadV1,
  FuzeEvent,
} from '@fuzefront/shared/kafka';

/**
 * The write path's view of the event bus (FF-EPIC-18-S4 / FFRNT-262).
 *
 * `configChanged` NEVER rejects and never throws: the write it announces has
 * already COMMITTED, and a bus problem must not turn a successful write into an
 * error. Staleness from a missed event is bounded by the consumers' ETag /
 * resolved-version poll (FF-EPIC-18-S5), which is why that poll is mandatory
 * for consumers rather than an optimisation.
 */
export interface ConfigChangeNotifier {
  configChanged(payload: ConfigChangedPayloadV1, correlationId?: string): Promise<void>;
  disconnect(): Promise<void>;
}

/** Minimal producer surface, so tests can inject a fake without a broker. */
export interface ChangedEventProducer {
  connect(): Promise<void>;
  send(
    topic: string,
    event: FuzeEvent<ConfigChangedPayloadV1>,
    schema: typeof configChangedSchemaV1,
    options?: { key?: string },
  ): Promise<void>;
  disconnect(): Promise<void>;
}

/** A hung broker must not pin a request's background task forever. */
const SEND_TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export class KafkaConfigChangePublisher implements ConfigChangeNotifier {
  private connecting: Promise<void> | null = null;

  constructor(private readonly producer: ChangedEventProducer) {}

  /** Lazy, retrying connect: a broker that is down at boot is picked up later. */
  private ensureConnected(): Promise<void> {
    if (!this.connecting) {
      this.connecting = withTimeout(this.producer.connect(), SEND_TIMEOUT_MS, 'kafka connect').catch((err) => {
        this.connecting = null; // retry on the next publish
        throw err;
      });
    }
    return this.connecting;
  }

  async configChanged(payload: ConfigChangedPayloadV1, correlationId?: string): Promise<void> {
    try {
      await this.ensureConnected();
      const event: FuzeEvent<ConfigChangedPayloadV1> = {
        version: '1.0',
        topic: TOPICS.CONFIG_CHANGED,
        correlationId: correlationId ?? randomUUID(),
        occurredAt: new Date().toISOString(),
        payload,
      };
      // Partition key = (namespace, scope): changes to one scope stay ordered.
      const key = `${payload.namespace}:${payload.scope.scopeType}:${payload.scope.scopeId ?? 'singleton'}`;
      await withTimeout(
        this.producer.send(TOPICS.CONFIG_CHANGED, event, configChangedSchemaV1, { key }),
        SEND_TIMEOUT_MS,
        'kafka send',
      );
    } catch (err) {
      // The write already committed. Log loudly (key NAMES only, no values) and
      // carry on — consumers recover via the version poll.
      // eslint-disable-next-line no-console
      console.error(
        '[config-service] config.changed publish FAILED (write committed; consumers will catch up via ETag poll) namespace=%s scope=%s:%s keys=%s:',
        payload.namespace,
        payload.scope.scopeType,
        payload.scope.scopeId ?? 'singleton',
        payload.changedKeys.join(','),
        err,
      );
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.producer.disconnect();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[config-service] config.changed producer disconnect failed:', err);
    }
  }
}

/**
 * Builds the publisher, or returns `null` when KAFKA_BROKERS is unset (CI,
 * local dev, the DATABASE_URL-less /health-only mode) — same broker-optional
 * rule as events/consumer.ts. Construction does not connect; the first publish
 * does, so a down broker can never delay startup or fail a write.
 */
export function createConfigChangePublisher(env: NodeJS.ProcessEnv = process.env): ConfigChangeNotifier | null {
  const brokers = (env.KAFKA_BROKERS ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  if (brokers.length === 0) return null;
  const kafka = createKafkaClient({ clientId: 'config-service-producer', brokers });
  return new KafkaConfigChangePublisher(new TypedProducer(kafka) as unknown as ChangedEventProducer);
}
