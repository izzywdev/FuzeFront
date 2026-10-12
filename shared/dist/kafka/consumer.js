"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypedConsumer = void 0;
exports.redactForDlq = redactForDlq;
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const types_1 = require("./types");
/**
 * The broker topic is the authority for routing.  The envelope's topic is
 * validated separately and must agree with it before a handler can see the
 * event.  This prevents a producer that is allowed to write one topic from
 * smuggling a different event type through a consumer that trusted only the
 * JSON payload.
 *
 * Correlation ids are intentionally strings (rather than UUIDs): historical
 * producers use readable identifiers.  They are still bounded so poison input
 * cannot become an unbounded log/DLQ record.
 */
const eventEnvelopeSchema = zod_1.z
    .object({
    version: zod_1.z.string().min(1).max(32),
    topic: zod_1.z.string().min(1).max(200),
    correlationId: zod_1.z.string().min(1).max(256),
    occurredAt: zod_1.z.string().datetime({ offset: true }),
    payload: zod_1.z.unknown(),
})
    .strict();
const SENSITIVE_KEY = /(token|secret|password|authorization|cookie|email|first_?name|last_?name)/i;
const MAX_DLQ_RAW_BYTES = 64 * 1024;
/**
 * DLQ records are operational data, not a second copy of the platform's PII
 * store.  Retain enough structured evidence to diagnose and manually replay
 * an event while removing credentials and direct-identifying profile fields.
 * For malformed or oversized input retain only a SHA-256 fingerprint.
 */
function redactForDlq(raw) {
    if (Buffer.byteLength(raw, 'utf8') > MAX_DLQ_RAW_BYTES) {
        return JSON.stringify({
            raw: '[REDACTED_OVERSIZED]',
            rawSha256: crypto_1.default.createHash('sha256').update(raw).digest('hex'),
        });
    }
    try {
        const redact = (value) => {
            if (Array.isArray(value))
                return value.map(redact);
            if (value && typeof value === 'object') {
                return Object.fromEntries(Object.entries(value).map(([key, child]) => [
                    key,
                    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(child),
                ]));
            }
            return value;
        };
        return JSON.stringify(redact(JSON.parse(raw)));
    }
    catch (_a) {
        return JSON.stringify({
            raw: '[REDACTED_UNPARSEABLE]',
            rawSha256: crypto_1.default.createHash('sha256').update(raw).digest('hex'),
        });
    }
}
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
                    envelope = eventEnvelopeSchema.parse(JSON.parse(raw));
                }
                catch (err) {
                    const reason = err instanceof zod_1.ZodError ? `Envelope validation failure: ${err.message}` : 'JSON parse failure';
                    await this.deadLetter(topic, raw, reason, dlqProducer);
                    return;
                }
                if (envelope.topic !== topic) {
                    await this.deadLetter(topic, raw, 'Envelope topic does not match Kafka topic', dlqProducer);
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
                messages: [{ value: JSON.stringify({ raw: redactForDlq(raw), reason, sourceTopic }) }],
            });
        }
    }
}
exports.TypedConsumer = TypedConsumer;
