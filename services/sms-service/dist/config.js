"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = void 0;
function loadConfig() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID ?? '';
    const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
    const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID ?? '';
    // Mock mode: no real creds, or explicitly requested via env
    const mock = process.env.TWILIO_MOCK === 'true' ||
        accountSid === '' ||
        accountSid.startsWith('AC_TEST');
    return {
        port: parseInt(process.env.PORT ?? '3004', 10),
        authSecret: process.env.SMS_AUTH_SECRET ?? '',
        twilio: { accountSid, authToken, verifyServiceSid, mock },
        rateLimiter: {
            cooldownMs: parseInt(process.env.RATE_COOLDOWN_MS ?? '30000', 10),
            maxPerHour: parseInt(process.env.RATE_MAX_PER_HOUR ?? '10', 10),
        },
    };
}
exports.loadConfig = loadConfig;
//# sourceMappingURL=config.js.map