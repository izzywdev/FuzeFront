"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const twilio_client_1 = require("./twilio-client");
const rate_limiter_1 = require("./rate-limiter");
const app_1 = require("./app");
async function main() {
    const config = (0, config_1.loadConfig)();
    const twilioClient = (0, twilio_client_1.createTwilioClient)(config.twilio);
    const rateLimiter = new rate_limiter_1.RateLimiter(config.rateLimiter);
    const app = (0, app_1.createApp)({
        authSecret: config.authSecret,
        twilioClient,
        verifyServiceSid: config.twilio.verifyServiceSid,
        rateLimiter,
    });
    const server = app.listen(config.port, () => {
        const mode = config.twilio.mock ? 'mock' : 'live';
        console.log(`[sms-service] Listening on port ${config.port} (Twilio: ${mode})`);
    });
    const shutdown = () => {
        console.log('[sms-service] Shutting down...');
        server.close(() => process.exit(0));
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
main().catch((err) => {
    console.error('[sms-service] Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map