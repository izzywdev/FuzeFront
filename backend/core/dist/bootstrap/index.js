"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExpressApp = createExpressApp;
exports.attachErrorHandlers = attachErrorHandlers;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const uuid_1 = require("uuid");
/**
 * Boilerplate Express app used by every FuzeFront backend service: helmet (CSP
 * tuned for microfrontend iframes), CORS, JSON/urlencoded parsing, request-id
 * logging. Route mounting + error/404 handlers are left to the caller (mount
 * routes, THEN call attachErrorHandlers). Zero business logic.
 */
function createExpressApp(options = {}) {
    const app = (0, express_1.default)();
    const serviceName = options.serviceName || 'backend';
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                frameSrc: ["'self'", '*'],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            },
        },
    }));
    app.use((0, cors_1.default)({
        origin: [
            process.env.FRONTEND_URL || 'http://localhost:5173',
            'http://localhost:8085',
            'http://localhost:3004',
            'http://fuzefront-frontend-prod:8080',
            ...(options.corsOrigins || []),
        ],
        credentials: true,
    }));
    app.use(express_1.default.json());
    app.use(express_1.default.urlencoded({ extended: true }));
    app.use((req, _res, next) => {
        const requestId = (0, uuid_1.v4)().substring(0, 8);
        req.requestId = requestId;
        console.log(`📥 [${serviceName}:${requestId}] ${req.method} ${req.path}`);
        next();
    });
    return app;
}
/**
 * Attach the standard 500 + 404 handlers. Call AFTER all routes are mounted.
 */
function attachErrorHandlers(app) {
    app.use((err, _req, res, _next) => {
        console.error(err.stack);
        res.status(500).json({ error: 'Something went wrong!' });
    });
    app.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
}
//# sourceMappingURL=index.js.map