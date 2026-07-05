"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FailSoftEmitter = exports.KafkaAppRegistryEmitter = void 0;
exports.setAppRegistryEmitter = setAppRegistryEmitter;
exports.getAppRegistryEmitter = getAppRegistryEmitter;
// Kafka event producer for the app-registry surface. Kafka is the durable
// system-of-record (the Socket.IO emits stay as a live UI push). Uses the shared
// TypedProducer + the FROZEN Zod schemas in shared/src/kafka/schemas/app.* (the
// schema VALUES are resolved at runtime from @fuzefront/shared so emission
// validates against the single source of truth; payload shapes are mirrored here
// as structural types so this slice compiles independently of the shared dist
// regeneration that adds the app.* exports).
//
// FAIL-SOFT: if Kafka is not configured (no KAFKA_BROKERS) or a send fails, we
// log and continue so local/dev/test and the HTTP request itself never break on
// a broker outage. The emitter is an interface so routes can be unit-tested with
// a stub (no broker required), mirroring services/billing-service's pattern.
const crypto_1 = require("crypto");
const TOPIC = {
    APP_REGISTERED: 'app.registered',
    APP_ACTIVATED: 'app.activated',
    APP_SUSPENDED: 'app.suspended',
    APP_HEARTBEAT: 'app.heartbeat',
};
/**
 * Kafka-backed emitter over the shared TypedProducer. The shared Zod schemas are
 * resolved lazily from @fuzefront/shared so each send is validated against the
 * frozen contract; if a schema is unavailable we send without local validation
 * (the broker still receives the envelope) rather than dropping the event.
 */
class KafkaAppRegistryEmitter {
    constructor(producer) {
        this.producer = producer;
        this.schemas = {};
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const shared = require('@fuzefront/shared/dist/kafka');
            this.schemas = {
                [TOPIC.APP_REGISTERED]: shared.appRegisteredSchemaV1,
                [TOPIC.APP_ACTIVATED]: shared.appActivatedSchemaV1,
                [TOPIC.APP_SUSPENDED]: shared.appSuspendedSchemaV1,
                [TOPIC.APP_HEARTBEAT]: shared.appHeartbeatSchemaV1,
            };
        }
        catch {
            this.schemas = {};
        }
    }
    appRegistered(payload, correlationId = (0, crypto_1.randomUUID)()) {
        return this.emit(TOPIC.APP_REGISTERED, payload, correlationId);
    }
    appActivated(payload, correlationId = (0, crypto_1.randomUUID)()) {
        return this.emit(TOPIC.APP_ACTIVATED, payload, correlationId);
    }
    appSuspended(payload, correlationId = (0, crypto_1.randomUUID)()) {
        return this.emit(TOPIC.APP_SUSPENDED, payload, correlationId);
    }
    appHeartbeat(payload, correlationId = (0, crypto_1.randomUUID)()) {
        return this.emit(TOPIC.APP_HEARTBEAT, payload, correlationId);
    }
    emit(topic, payload, correlationId) {
        const schema = this.schemas[topic] ?? passthroughSchema();
        return this.producer.send(topic, {
            version: '1.0',
            topic,
            correlationId,
            occurredAt: new Date().toISOString(),
            payload,
        }, schema);
    }
}
exports.KafkaAppRegistryEmitter = KafkaAppRegistryEmitter;
/** Zod-like no-op validator used only if the shared schema export is missing. */
function passthroughSchema() {
    return { parse: (v) => v };
}
/**
 * Wraps any emitter so emit failures NEVER propagate to the HTTP request — they
 * are logged and swallowed (Kafka is system-of-record but must not break the
 * synchronous API path). Also the default when Kafka is unconfigured.
 */
class FailSoftEmitter {
    constructor(inner, logger = console) {
        this.inner = inner;
        this.logger = logger;
    }
    async guard(name, fn) {
        if (!this.inner) {
            this.logger.warn(`[app-registry][events] Kafka not configured — skipping ${name}`);
            return;
        }
        try {
            await fn();
        }
        catch (err) {
            this.logger.error(`[app-registry][events] failed to emit ${name} (continuing):`, err instanceof Error ? err.message : String(err));
        }
    }
    appRegistered(payload, correlationId) {
        return this.guard('app.registered', () => this.inner.appRegistered(payload, correlationId));
    }
    appActivated(payload, correlationId) {
        return this.guard('app.activated', () => this.inner.appActivated(payload, correlationId));
    }
    appSuspended(payload, correlationId) {
        return this.guard('app.suspended', () => this.inner.appSuspended(payload, correlationId));
    }
    appHeartbeat(payload, correlationId) {
        return this.guard('app.heartbeat', () => this.inner.appHeartbeat(payload, correlationId));
    }
}
exports.FailSoftEmitter = FailSoftEmitter;
let cachedEmitter = null;
/** Test/DI seam — inject a stub emitter. */
function setAppRegistryEmitter(e) {
    cachedEmitter = e;
}
/**
 * Lazily builds the process-wide fail-soft emitter. Connects a Kafka producer
 * only when KAFKA_BROKERS is set; otherwise returns a fail-soft emitter that
 * logs+skips so local/dev/test keep working with no broker.
 */
function getAppRegistryEmitter() {
    if (cachedEmitter)
        return cachedEmitter;
    const brokers = (process.env.KAFKA_BROKERS || '').trim();
    if (!brokers) {
        cachedEmitter = new FailSoftEmitter(null);
        return cachedEmitter;
    }
    try {
        // Lazy require so kafkajs + the shared producer are only needed where Kafka
        // is configured.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Kafka } = require('kafkajs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { TypedProducer } = require('@fuzefront/shared/dist/kafka');
        const kafka = new Kafka({
            clientId: 'applications-service',
            brokers: brokers.split(',').map((b) => b.trim()),
        });
        const producer = new TypedProducer(kafka);
        producer.connect().catch((err) => {
            console.error('[app-registry][events] producer connect failed (will fail-soft):', err instanceof Error ? err.message : String(err));
        });
        cachedEmitter = new FailSoftEmitter(new KafkaAppRegistryEmitter(producer));
    }
    catch (err) {
        console.error('[app-registry][events] kafka init failed — fail-soft (no events):', err instanceof Error ? err.message : String(err));
        cachedEmitter = new FailSoftEmitter(null);
    }
    return cachedEmitter;
}
//# sourceMappingURL=events.js.map