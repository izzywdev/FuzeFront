import { Kafka } from 'kafkajs';
/**
 * Factory so callers can inject a mock Kafka instance in tests.
 * Production code calls this once at startup.
 */
export function createKafkaClient(config) {
    return new Kafka({
        clientId: config.clientId,
        brokers: config.brokers,
        retry: config.retry,
    });
}
