"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeOutboxPublisher = makeOutboxPublisher;
exports.createKafkaOutboxPublisher = createKafkaOutboxPublisher;
exports.startOutboxRelayFromEnv = startOutboxRelayFromEnv;
const kafka_1 = require("@fuzefront/shared/kafka");
const outboxRelay_1 = require("./outboxRelay");
/**
 * The generic transport wiring, decoupled from how the producer is obtained so
 * it is unit-testable with a fake. Builds the `FuzeEvent` envelope, derives the
 * partition key, and validates against the shared schema registry (unmapped
 * topics publish raw). `getProducer` is called lazily/memoised by the caller.
 */
function makeOutboxPublisher(getProducer) {
    const publish = async (record) => {
        // A connect/send failure throws → the relay leaves the row 'pending'.
        const p = await getProducer();
        const event = {
            version: '1.0',
            topic: record.topic,
            correlationId: record.correlationId,
            occurredAt: new Date().toISOString(),
            payload: record.payload,
        };
        const key = (0, kafka_1.partitionKeyForPayload)(record.payload);
        const schema = (0, kafka_1.schemaForTopic)(record.topic);
        if (schema) {
            await p.send(record.topic, event, schema, { key });
        }
        else {
            await p.raw.send({
                topic: record.topic,
                messages: [{ key, value: JSON.stringify(event) }],
            });
        }
    };
    const deadLetter = async (record) => {
        const p = await getProducer();
        await p.raw.send({
            topic: (0, kafka_1.dlqTopic)(record.topic),
            messages: [
                { value: JSON.stringify({ raw: record, reason: 'outbox max attempts exhausted' }) },
            ],
        });
    };
    const disconnect = async () => {
        // Only disconnect a producer that was actually created.
        const p = await getProducer().catch(() => null);
        if (p)
            await p.disconnect();
    };
    return { publish, deadLetter, disconnect };
}
/**
 * Builds an outbox publisher backed by a lazily-connected Kafka `TypedProducer`.
 */
function createKafkaOutboxPublisher(config) {
    let producer = null;
    let connecting = null;
    const getProducer = async () => {
        if (producer)
            return producer;
        if (!connecting) {
            connecting = (async () => {
                const kafka = (0, kafka_1.createKafkaClient)({
                    clientId: config.clientId || 'fuzefront-outbox-relay',
                    brokers: config.brokers,
                });
                const p = new kafka_1.TypedProducer(kafka);
                await p.connect();
                producer = p;
                return p;
            })().catch(err => {
                connecting = null; // don't cache a failed connection
                throw err;
            });
        }
        return connecting;
    };
    const base = makeOutboxPublisher(getProducer);
    return {
        ...base,
        disconnect: async () => {
            if (producer) {
                await producer.disconnect();
                producer = null;
                connecting = null;
            }
        },
    };
}
/**
 * Start the transactional-outbox relay with the Kafka transport wired from the
 * environment — the one-call, install-and-go entry point for any backend
 * service. Returns null (a no-op) when no broker is configured, so events stay
 * durably in `event_outbox` until one is.
 */
function startOutboxRelayFromEnv(opts) {
    const brokersRaw = opts.brokers ?? process.env.KAFKA_BROKERS;
    if (!brokersRaw) {
        opts.logger?.info('KAFKA_BROKERS unset — outbox relay disabled (events held in event_outbox)');
        return null;
    }
    const brokers = brokersRaw
        .split(',')
        .map(b => b.trim())
        .filter(Boolean);
    const { publish, deadLetter, disconnect } = createKafkaOutboxPublisher({
        brokers,
        clientId: opts.clientId,
    });
    const handle = (0, outboxRelay_1.startOutboxRelay)({
        db: opts.db,
        publish,
        onDeadLetter: deadLetter,
        intervalMs: opts.intervalMs ?? Number(process.env.OUTBOX_RELAY_INTERVAL_MS || 1000),
        logger: opts.logger,
    });
    return { stop: handle.stop, disconnect };
}
//# sourceMappingURL=kafkaPublisher.js.map