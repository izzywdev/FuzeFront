import { Producer, Kafka } from 'kafkajs';
import { ZodSchema } from 'zod';
import { FuzeEvent, TopicName } from './types';
export declare class TypedProducer {
    private producer;
    constructor(kafka: Kafka);
    connect(): Promise<void>;
    /**
     * Validates `event.payload` against `schema` then sends the event.
     * Throws ZodError if validation fails (caller should dead-letter).
     *
     * `options.key` sets the Kafka message key — pass the entity id (org/user)
     * so all events for one entity land on the same partition and stay ordered.
     * Omitting it preserves the previous round-robin behaviour.
     */
    send<T>(topic: TopicName | string, event: FuzeEvent<T>, schema: ZodSchema<T>, options?: {
        key?: string;
    }): Promise<void>;
    disconnect(): Promise<void>;
    /** Expose the raw KafkaJS producer for testing */
    get raw(): Producer;
}
