import { Kafka, KafkaConfig } from 'kafkajs';
export interface KafkaClientConfig {
    clientId: string;
    brokers: string[];
    /** Retry config; defaults to KafkaJS defaults */
    retry?: KafkaConfig['retry'];
}
/**
 * Factory so callers can inject a mock Kafka instance in tests.
 * Production code calls this once at startup.
 */
export declare function createKafkaClient(config: KafkaClientConfig): Kafka;
