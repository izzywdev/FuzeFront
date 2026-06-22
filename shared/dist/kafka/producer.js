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
     */
    async send(topic, event, schema) {
        schema.parse(event.payload); // throws ZodError on failure
        await this.producer.send({
            topic,
            messages: [{ value: JSON.stringify(event) }],
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
