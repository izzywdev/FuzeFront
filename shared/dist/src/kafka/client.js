"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createKafkaClient = createKafkaClient;
const kafkajs_1 = require("kafkajs");
/**
 * Factory so callers can inject a mock Kafka instance in tests.
 * Production code calls this once at startup.
 */
function createKafkaClient(config) {
    return new kafkajs_1.Kafka({
        clientId: config.clientId,
        brokers: config.brokers,
        retry: config.retry,
    });
}
