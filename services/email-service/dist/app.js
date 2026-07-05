"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = void 0;
const express_1 = __importDefault(require("express"));
function createApp() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', service: 'email-service' });
    });
    return app;
}
exports.createApp = createApp;
//# sourceMappingURL=app.js.map