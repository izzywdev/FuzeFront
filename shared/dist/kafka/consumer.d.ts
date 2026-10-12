import { Kafka } from 'kafkajs';
import { ZodSchema } from 'zod';
import { FuzeEvent } from './types';
import { TypedProducer } from './producer';
export type EventHandler<T> = (event: FuzeEvent<T>) => Promise<void>;
/**
 * DLQ records are operational data, not a second copy of the platform's PII
 * store.  Retain enough structured evidence to diagnose and manually replay
 * an event while removing credentials and direct-identifying profile fields.
 * For malformed or oversized input retain only a SHA-256 fingerprint.
 */
export declare function redactForDlq(raw: string): string;
export declare class TypedConsumer {
    private consumer;
    constructor(kafka: Kafka, groupId: string);
    connect(): Promise<void>;
    subscribe(topic: string, fromBeginning?: boolean): Promise<void>;
    /**
     * Runs the consumer loop.
     * - Deserializes each message as JSON.
     * - Validates the payload with `schema`.
     * - On ZodError or JSON parse failure, emits to the DLQ topic via `dlqProducer`
     *   (if provided) and skips the message so the consumer stays healthy.
     */
    run<T>(handler: EventHandler<T>, schema: ZodSchema<T>, dlqProducer?: TypedProducer): Promise<void>;
    disconnect(): Promise<void>;
    private deadLetter;
}
