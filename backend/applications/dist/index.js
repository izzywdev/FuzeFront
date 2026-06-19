"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// FuzeFront applications-service — Phase 0 scaffold (health only on :3003).
// Apps routes + Socket.IO + migrations are wired in Phase 2.
const dotenv_1 = __importDefault(require("dotenv"));
const http_1 = require("http");
const core_1 = require("@fuzefront/core");
dotenv_1.default.config();
const PORT = process.env.PORT || 3003;
const app = (0, core_1.createExpressApp)({ serviceName: 'applications-service' });
const httpServer = (0, http_1.createServer)(app);
const startTime = Date.now();
const health = async (_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const dbHealthy = await (0, core_1.checkDatabaseHealth)().catch(() => false);
    res.json({
        status: dbHealthy ? 'ok' : 'degraded',
        service: 'applications-service',
        timestamp: new Date().toISOString(),
        uptime,
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        database: { status: dbHealthy ? 'connected' : 'disconnected' },
    });
};
app.get('/health', health);
app.get('/api/health', health);
(0, core_1.attachErrorHandlers)(app);
function gracefulShutdown(signal) {
    console.log(`\n🛑 [applications-service] Received ${signal}. Shutting down...`);
    httpServer.close(async () => {
        await (0, core_1.closeDatabase)().catch(() => undefined);
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 30000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
async function startServer() {
    try {
        console.log('🔄 Starting FuzeFront applications-service...');
        await (0, core_1.waitForPostgres)(30, 2000);
        (0, core_1.initializeDatabaseConnection)({ migrationsTableName: 'knex_migrations_apps' });
        const portNumber = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
        httpServer.listen(portNumber, () => {
            console.log(`🚀 applications-service running on port ${portNumber}`);
        });
    }
    catch (error) {
        console.error('❌ [applications-service] Failed to start:', error);
        process.exit(1);
    }
}
startServer();
exports.default = app;
//# sourceMappingURL=index.js.map