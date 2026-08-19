"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultEventPublisher = void 0;
exports.disconnectEventPublisher = disconnectEventPublisher;
const kafka_1 = require("@fuzefront/shared/kafka");
let producer = null;
let connecting = null;
function kafkaEnabled() {
    return !!process.env.KAFKA_BROKERS;
}
async function getProducer() {
    if (!kafkaEnabled())
        return null;
    if (producer)
        return producer;
    if (!connecting) {
        connecting = (async () => {
            const brokers = process.env.KAFKA_BROKERS
                .split(',')
                .map(b => b.trim())
                .filter(Boolean);
            const kafka = (0, kafka_1.createKafkaClient)({
                clientId: process.env.KAFKA_CLIENT_ID || 'fuzefront-backend',
                brokers,
            });
            const p = new kafka_1.TypedProducer(kafka);
            await p.connect();
            producer = p;
            return p;
        })().catch(err => {
            // Don't cache a failed connection; allow retry on next publish.
            connecting = null;
            console.error('⚠️ Kafka producer connect failed:', err);
            return null;
        });
    }
    return connecting;
}
function envelope(topic, payload, correlationId) {
    return {
        version: '1.0',
        topic,
        correlationId,
        occurredAt: new Date().toISOString(),
        payload,
    };
}
exports.defaultEventPublisher = {
    async publishIdentityUserCreated(payload, correlationId) {
        const p = await getProducer();
        if (!p) {
            console.log(`ℹ️ Kafka disabled — skipping ${kafka_1.TOPICS.IDENTITY_USER_CREATED} publish (outbox holds it)`);
            return;
        }
        await p.send(kafka_1.TOPICS.IDENTITY_USER_CREATED, envelope(kafka_1.TOPICS.IDENTITY_USER_CREATED, payload, correlationId), kafka_1.identityUserCreatedSchemaV1);
    },
    async publishNotifyEmailRequested(payload, correlationId) {
        const p = await getProducer();
        if (!p) {
            console.log(`ℹ️ Kafka disabled — skipping ${kafka_1.TOPICS.NOTIFY_EMAIL_REQUESTED} publish (outbox holds it)`);
            return;
        }
        await p.send(kafka_1.TOPICS.NOTIFY_EMAIL_REQUESTED, envelope(kafka_1.TOPICS.NOTIFY_EMAIL_REQUESTED, payload, correlationId), kafka_1.notifyEmailRequestedSchemaV1);
    },
};
/** Disconnect the shared producer (graceful shutdown). */
async function disconnectEventPublisher() {
    if (producer) {
        await producer.disconnect();
        producer = null;
        connecting = null;
    }
}
//# sourceMappingURL=eventPublisher.js.map