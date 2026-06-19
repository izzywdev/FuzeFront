"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = void 0;
const express_1 = __importDefault(require("express"));
const crypto_1 = require("crypto");
const send_1 = require("./routes/send");
const verify_1 = require("./routes/verify");
function createApp(deps) {
    const app = (0, express_1.default)();
    // Trust exactly one proxy hop (the ingress).  This lets Express set req.ip
    // from the ingress-written X-Forwarded-For entry rather than from the raw
    // header, which a client could forge arbitrarily.
    app.set('trust proxy', 1);
    app.use(express_1.default.json());
    // Health — no auth required
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', service: 'sms-service' });
    });
    // Shared-secret auth middleware for all /sms/* routes
    app.use('/sms', (req, res, next) => {
        if (!deps.authSecret) {
            // No secret configured — reject all (prevents accidental open access)
            res.status(401).json({ error: 'SMS service not configured (no auth secret)' });
            return;
        }
        const header = req.headers['authorization'];
        const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
        // Constant-time comparison to prevent timing side-channel attacks.
        // Length check is required first because timingSafeEqual throws when
        // buffer lengths differ.
        const secretBuf = Buffer.from(deps.authSecret);
        const tokenBuf = token ? Buffer.from(token) : Buffer.alloc(0);
        const valid = token !== undefined &&
            tokenBuf.length === secretBuf.length &&
            (0, crypto_1.timingSafeEqual)(tokenBuf, secretBuf);
        if (!valid) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        next();
    });
    app.post('/sms/send', (0, send_1.makeSendHandler)({
        twilioClient: deps.twilioClient,
        verifyServiceSid: deps.verifyServiceSid,
        rateLimiter: deps.rateLimiter,
    }));
    app.post('/sms/verify', (0, verify_1.makeVerifyHandler)({
        twilioClient: deps.twilioClient,
        verifyServiceSid: deps.verifyServiceSid,
    }));
    return app;
}
exports.createApp = createApp;
//# sourceMappingURL=app.js.map