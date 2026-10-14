import { Knex } from 'knex';
import { ZodSchema } from 'zod';
import { FuzeEvent } from '@fuzefront/shared/kafka';
import { OutboxRecord, OutboxRelayHandle } from './outboxRelay';
export interface KafkaPublisherConfig {
    brokers: string[];
    clientId?: string;
}
export interface KafkaOutboxPublisher {
    /** Publish an outbox record to Kafka (validates via the shared schema registry). */
    publish: (record: OutboxRecord) => Promise<void>;
    /** Route an exhausted record to its `<topic>.dlq`. */
    deadLetter: (record: OutboxRecord) => Promise<void>;
    /** Disconnect the underlying producer (graceful shutdown). */
    disconnect: () => Promise<void>;
}
/** Minimal producer surface the publisher needs — satisfied by `TypedProducer`. */
export interface ProducerLike {
    send<T>(topic: string, event: FuzeEvent<T>, schema: ZodSchema<T>, options?: {
        key?: string;
    }): Promise<void>;
    raw: {
        send(payload: {
            topic: string;
            messages: Array<{
                key?: string;
                value: string;
            }>;
        }): Promise<unknown>;
    };
    disconnect(): Promise<void>;
}
/**
 * The generic transport wiring, decoupled from how the producer is obtained so
 * it is unit-testable with a fake. Builds the `FuzeEvent` envelope, derives the
 * partition key, and validates against the shared schema registry (unmapped
 * topics publish raw). `getProducer` is called lazily/memoised by the caller.
 */
export declare function makeOutboxPublisher(getProducer: () => Promise<ProducerLike>): KafkaOutboxPublisher;
/**
 * Builds an outbox publisher backed by a lazily-connected Kafka `TypedProducer`.
 */
export declare function createKafkaOutboxPublisher(config: KafkaPublisherConfig): KafkaOutboxPublisher;
export interface OutboxRelayFromEnvHandle extends OutboxRelayHandle {
    disconnect: () => Promise<void>;
}
/**
 * Start the transactional-outbox relay with the Kafka transport wired from the
 * environment — the one-call, install-and-go entry point for any backend
 * service. Returns null (a no-op) when no broker is configured, so events stay
 * durably in `event_outbox` until one is.
 */
export declare function startOutboxRelayFromEnv(opts: {
    db: Knex;
    brokers?: string;
    clientId?: string;
    intervalMs?: number;
    logger?: {
        info: (m: string) => void;
        error: (m: string) => void;
    };
}): OutboxRelayFromEnvHandle | null;
//# sourceMappingURL=kafkaPublisher.d.ts.map