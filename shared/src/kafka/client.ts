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
export function createKafkaClient(config: KafkaClientConfig): Kafka {
  return new Kafka({
    clientId: config.clientId,
    brokers: config.brokers,
    retry: config.retry,
  });
}
