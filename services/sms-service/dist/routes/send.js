"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSendHandler = void 0;
const zod_1 = require("zod");
const rate_limiter_1 = require("../rate-limiter");
const E164_RE = /^\+[1-9]\d{6,14}$/;
const sendSchema = zod_1.z.object({
    to: zod_1.z.string().regex(E164_RE, 'Phone number must be in E.164 format (e.g. +15551234567)'),
});
function makeSendHandler(deps) {
    return async function sendHandler(req, res) {
        const parsed = sendSchema.safeParse(req.body);
        if (!parsed.success) {
            // Cast to access error — zod's SafeParseReturnType discriminant is not
            // always narrowed in older ts-jest setups
            const failure = parsed;
            const msg = failure.error.errors[0]?.message ?? 'Invalid request';
            res.status(400).json({ error: msg });
            return;
        }
        const { to } = parsed.data;
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ??
            req.socket.remoteAddress ??
            'unknown';
        try {
            deps.rateLimiter.check(to, ip);
        }
        catch (err) {
            if (err instanceof rate_limiter_1.RateLimitError) {
                res.status(429).json({ error: err.message });
                return;
            }
            throw err;
        }
        await deps.twilioClient.verify.v2
            .services(deps.verifyServiceSid)
            .verifications.create({ to, channel: 'sms' });
        res.json({ ok: true });
    };
}
exports.makeSendHandler = makeSendHandler;
//# sourceMappingURL=send.js.map