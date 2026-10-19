import { Kafka, Producer, KafkaConfig } from 'kafkajs';
import type { MeteringClientConfig, UsageEvent } from './types';

const DEFAULT_TOPIC = 'billing.usage';

/**
 * MeteringClient emits UsageEvent records to Kafka so that billing-service
 * can consume and flush them to Stripe Billing Meter Events.
 *
 * Design contract:
 * - emit() MUST NEVER throw — a metering failure must never fail a request.
 *   Errors are swallowed and logged; the caller is never aware.
 * - flush() disconnects the producer for graceful shutdown.
 * - static fromEnv() is the preferred factory in production — reads
 *   KAFKA_BROKERS from the environment.
 *
 * Feature flag: fuzefront.billing.metered-usage-emit (release, default OFF)
 * When OFF, emit() is a no-op — the middleware is installed but silent.
 * This lets operators enable metering per-service without a redeploy.
 * Owner: billing-team. Removal criterion: fully rolled out to all services.
 */
export class MeteringClient {
  private readonly producer: Producer;
  private readonly topic: string;
  private connectPromise: Promise<void> | null = null;

  constructor(private readonly config: MeteringClientConfig) {
    this.topic = config.topic ?? DEFAULT_TOPIC;

    const kafkaCfg: KafkaConfig = {
      clientId: `metered-usage-${config.serviceName}`,
      brokers: config.kafka.brokers,
    };
    const kafka = new Kafka(kafkaCfg);
    this.producer = kafka.producer();
  }

  /**
   * Emit a usage event to Kafka.
   *
   * Guaranteed not to throw — errors are caught and logged.
   * Connect is lazy (first call) so a service that never has billable traffic
   * does not open a Kafka connection unnecessarily.
   */
  async emit(event: UsageEvent): Promise<void> {
    try {
      if (!this.connectPromise) {
        this.connectPromise = this.producer.connect();
      }
      await this.connectPromise;
      await this.producer.send({
        topic: this.topic,
        messages: [
          {
            key: `${event.entityType}:${event.entityId}`,
            value: JSON.stringify(event),
            headers: {
              'content-type': 'application/json',
              'service-name': this.config.serviceName,
            },
          },
        ],
      });
    } catch (err) {
      // Metering MUST NOT fail requests — swallow and log only.
      // eslint-disable-next-line no-console
      console.error(
        `[metered-usage] failed to emit event`,
        {
          meterEventName: event.meterEventName,
          entityType: event.entityType,
          entityId: event.entityId,
          serviceName: this.config.serviceName,
          err: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  /**
   * Disconnect the Kafka producer.  Call during graceful shutdown.
   */
  async flush(): Promise<void> {
    if (this.connectPromise) {
      try {
        await this.connectPromise;
      } catch {
        this.connectPromise = null;
        return;
      }
      await this.producer.disconnect();
      this.connectPromise = null;
    }
  }

  /**
   * Factory that reads KAFKA_BROKERS from the environment.
   *
   * KAFKA_BROKERS is expected to be a comma-separated list of broker addresses,
   * e.g. "kafka:9092,kafka2:9092".
   *
   * @param serviceName - identifying name of the consuming service
   */
  static fromEnv(serviceName: string): MeteringClient {
    const brokersEnv = process.env.KAFKA_BROKERS ?? 'kafka:9092';
    const brokers = brokersEnv.split(',').map((b) => b.trim()).filter(Boolean);
    return new MeteringClient({ kafka: { brokers }, serviceName });
  }
}
