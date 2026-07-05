"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = void 0;
function loadConfig() {
    const brokers = (process.env.KAFKA_BROKERS || 'fuzeinfra-kafka:9092')
        .split(',')
        .map((b) => b.trim());
    const provider = (process.env.EMAIL_PROVIDER || 'smtp');
    return {
        port: parseInt(process.env.PORT || '3003', 10),
        kafka: {
            brokers,
            clientId: process.env.KAFKA_CLIENT_ID || 'email-service',
            groupId: process.env.KAFKA_GROUP_ID || 'email-service-group',
        },
        email: {
            provider,
            from: process.env.EMAIL_FROM || 'noreply@fuzefront.com',
            sendgridApiKey: process.env.SENDGRID_API_KEY,
            smtp: provider === 'smtp'
                ? {
                    host: process.env.SMTP_HOST || 'localhost',
                    port: parseInt(process.env.SMTP_PORT || '1025', 10),
                    secure: process.env.SMTP_SECURE === 'true',
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                }
                : undefined,
        },
    };
}
exports.loadConfig = loadConfig;
//# sourceMappingURL=config.js.map