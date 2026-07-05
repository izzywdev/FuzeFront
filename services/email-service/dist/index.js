"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const shared_1 = require("@fuzefront/shared");
const config_1 = require("./config");
const providers_1 = require("./providers");
const email_requested_handler_1 = require("./handlers/email-requested.handler");
const app_1 = require("./app");
async function main() {
    const config = (0, config_1.loadConfig)();
    // --- Email provider ---
    const provider = (0, providers_1.createProvider)(config);
    // --- Kafka ---
    const kafka = (0, shared_1.createKafkaClient)({
        clientId: config.kafka.clientId,
        brokers: config.kafka.brokers,
    });
    const statusProducer = new shared_1.TypedProducer(kafka);
    await statusProducer.connect();
    const consumer = new shared_1.TypedConsumer(kafka, config.kafka.groupId);
    await consumer.connect();
    await consumer.subscribe(shared_1.TOPICS.NOTIFY_EMAIL_REQUESTED);
    await consumer.run((event) => (0, email_requested_handler_1.handleEmailRequested)(event, { provider, statusProducer, from: config.email.from }), shared_1.notifyEmailRequestedSchemaV1, statusProducer);
    // --- HTTP ---
    const app = (0, app_1.createApp)();
    app.listen(config.port, () => {
        console.log(`[email-service] Listening on port ${config.port}`);
    });
    // --- Graceful shutdown ---
    const shutdown = async () => {
        console.log('[email-service] Shutting down...');
        await consumer.disconnect();
        await statusProducer.disconnect();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
main().catch((err) => {
    console.error('[email-service] Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map