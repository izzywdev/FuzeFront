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
     */
    send<T>(topic: TopicName | string, event: FuzeEvent<T>, schema: ZodSchema<T>): Promise<void>;
    disconnect(): Promise<void>;
    /** Expose the raw KafkaJS producer for testing */
    get raw(): Producer;
}
