"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypedConsumer = void 0;
const zod_1 = require("zod");
const types_1 = require("./types");
class TypedConsumer {
    constructor(kafka, groupId) {
        this.consumer = kafka.consumer({ groupId });
    }
    async connect() {
        await this.consumer.connect();
    }
    async subscribe(topic, fromBeginning = false) {
        await this.consumer.subscribe({ topic, fromBeginning });
    }
    /**
     * Runs the consumer loop.
     * - Deserializes each message as JSON.
     * - Validates the payload with `schema`.
     * - On ZodError or JSON parse failure, emits to the DLQ topic via `dlqProducer`
     *   (if provided) and skips the message so the consumer stays healthy.
     */
    async run(handler, schema, dlqProducer) {
        await this.consumer.run({
            eachMessage: async ({ topic, message }) => {
                var _a;
                const raw = (_a = message.value) === null || _a === void 0 ? void 0 : _a.toString();
                if (!raw)
                    return;
                let envelope;
                try {
                    envelope = JSON.parse(raw);
                }
                catch (err) {
                    await this.deadLetter(topic, raw, 'JSON parse failure', dlqProducer);
                    return;
                }
                let parsed;
                try {
                    parsed = schema.parse(envelope.payload);
                }
                catch (err) {
                    const msg = err instanceof zod_1.ZodError ? err.message : String(err);
                    await this.deadLetter(topic, raw, msg, dlqProducer);
                    return;
                }
                await handler(Object.assign(Object.assign({}, envelope), { payload: parsed }));
            },
        });
    }
    async disconnect() {
        await this.consumer.disconnect();
    }
    async deadLetter(sourceTopic, raw, reason, dlqProducer) {
        console.error(`[TypedConsumer] Dead-lettering message from ${sourceTopic}: ${reason}`);
        if (dlqProducer) {
            const dlq = (0, types_1.dlqTopic)(sourceTopic);
            await dlqProducer.raw.send({
                topic: dlq,
                messages: [{ value: JSON.stringify({ raw, reason, sourceTopic }) }],
            });
        }
    }
}
exports.TypedConsumer = TypedConsumer;
