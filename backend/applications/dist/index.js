"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// FuzeFront applications-service — app registry, Module-Federation remotes,
// heartbeat, health, and Socket.IO. Owns the apps DDL via its own idempotent
// migration chain under knex_migrations_apps, and waits for the organizations
// table (created by security-service) before running migration 002's FK. Dual-
// serves alongside the old monolith until the Phase 3 cutover.
const dotenv_1 = __importDefault(require("dotenv"));
const http_1 = require("http");
const path_1 = __importDefault(require("path"));
const core_1 = require("@fuzefront/core");
const apps_1 = __importDefault(require("./routes/apps"));
const app_registry_1 = __importDefault(require("./routes/app-registry"));
const builtins_1 = require("./app-registry/builtins");
const socketHandler_1 = require("./sockets/socketHandler");
dotenv_1.default.config();
const PORT = process.env.PORT || 3003;
const app = (0, core_1.createExpressApp)({ serviceName: 'applications-service' });
const httpServer = (0, http_1.createServer)(app);
const startTime = Date.now();
// Socket.IO lives here (applications-service owns /socket.io). Routes reach it
// via req.app.get('io'), so make it available on the app.
const io = (0, socketHandler_1.initializeSocketIO)(httpServer);
app.set('io', io);
app.use('/api/apps', apps_1.default);
// Frozen versioned app-registry contract surface (services/app-registry-service/
// openapi.yaml) — mounted ALONGSIDE the legacy /api/apps for back-compat.
app.use('/api/v1/app-registry', app_registry_1.default);
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
    httpServer.close(() => {
        io.close(async () => {
            await (0, core_1.closeDatabase)().catch(() => undefined);
            process.exit(0);
        });
    });
    setTimeout(() => process.exit(1), 30000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
/**
 * Boot sequence with cross-service startup ordering: wait for Postgres, ensure
 * the DB exists, then wait for the `organizations` table (owned by security-
 * service) to exist BEFORE running our migrations — migration 002 adds an
 * organization_id FK to organizations. All in-process; no initContainer.
 */
async function startServer() {
    try {
        console.log('🔄 Starting FuzeFront applications-service...');
        const dbOptions = {
            migrationsTableName: 'knex_migrations_apps',
            migrationsDir: path_1.default.join(__dirname, 'migrations'),
            seedsDir: path_1.default.join(__dirname, 'seeds'),
        };
        (0, core_1.configureDatabase)(dbOptions);
        await (0, core_1.waitForPostgres)(30, 2000);
        await (0, core_1.ensureDatabase)();
        // Cross-service ordering: organizations must exist before our FK migration.
        await (0, core_1.waitForTable)('organizations', 60, 2000);
        await (0, core_1.runMigrations)(dbOptions);
        (0, core_1.initializeDatabaseConnection)(dbOptions);
        if (process.env.NODE_ENV !== 'production') {
            await (0, core_1.runSeeds)(dbOptions);
        }
        // Built-in apps (e.g. Clock) are provisioned idempotently on EVERY boot
        // (production included) so they appear in the menu out of the box, separate
        // from the dev-only demo seeds above. Best-effort: never aborts startup.
        await (0, builtins_1.ensureBuiltins)().catch(err => console.error('⚠️  [applications-service] ensureBuiltins failed:', err));
        const portNumber = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
        httpServer.listen(portNumber, () => {
            console.log(`🚀 applications-service running on port ${portNumber}`);
            console.log(`📡 Socket.IO server ready`);
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