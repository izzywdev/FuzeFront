"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypedProducer = void 0;
class TypedProducer {
    constructor(kafka) {
        this.producer = kafka.producer();
    }
    async connect() {
        await this.producer.connect();
    }
    /**
     * Validates `event.payload` against `schema` then sends the event.
     * Throws ZodError if validation fails (caller should dead-letter).
     *
     * `options.key` sets the Kafka message key — pass the entity id (org/user)
     * so all events for one entity land on the same partition and stay ordered.
     * Omitting it preserves the previous round-robin behaviour.
     */
    async send(topic, event, schema, options) {
        schema.parse(event.payload); // throws ZodError on failure
        await this.producer.send({
            topic,
            messages: [{ key: options === null || options === void 0 ? void 0 : options.key, value: JSON.stringify(event) }],
        });
    }
    async disconnect() {
        await this.producer.disconnect();
    }
    /** Expose the raw KafkaJS producer for testing */
    get raw() {
        return this.producer;
    }
}
exports.TypedProducer = TypedProducer;
