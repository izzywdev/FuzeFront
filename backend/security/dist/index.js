"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// FuzeFront security-service — identity, organizations, provisioning, OIDC,
// Permit. Runs the original 001-009 migration chain against the existing
// `knex_migrations` table (002/006 are no-op tombstones; applications-service
// owns apps DDL). Dual-serves alongside the old monolith until Phase 3 cutover.
const dotenv_1 = __importDefault(require("dotenv"));
const http_1 = require("http");
const core_1 = require("@fuzefront/core");
const path_1 = __importDefault(require("path"));
const auth_1 = __importDefault(require("./routes/auth"));
const organizations_1 = __importDefault(require("./routes/organizations"));
const invitations_1 = __importDefault(require("./routes/invitations"));
const internal_1 = __importDefault(require("./routes/internal"));
const api_tokens_1 = __importStar(require("./routes/api-tokens"));
const api_token_auth_1 = require("./middleware/api-token-auth");
const oidc_1 = require("./services/oidc");
dotenv_1.default.config();
const PORT = process.env.PORT || 3002;
const app = (0, core_1.createExpressApp)({ serviceName: 'security-service' });
const httpServer = (0, http_1.createServer)(app);
const startTime = Date.now();
// Domain routes (identical paths to the monolith).
app.use('/api/auth', auth_1.default);
// Org-token sub-route: GET /api/organizations/:orgId/tokens (rate-limited, mounted BEFORE
// organizationsRoutes so the specific /:orgId/tokens path cannot be shadowed by any future wildcard)
app.use('/api/organizations', api_token_auth_1.tokenAuthRateLimiter, api_tokens_1.orgTokensRouter);
app.use('/api/organizations', organizations_1.default);
app.use('/api/invitations', invitations_1.default);
// API token CRUD — rate limiter applied to all /api/tokens/* routes
app.use('/api/tokens', api_token_auth_1.tokenAuthRateLimiter, api_tokens_1.default);
// Cluster-internal only — NEVER exposed through the public ingress.
app.use('/internal', internal_1.default);
const health = async (_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const dbHealthy = await (0, core_1.checkDatabaseHealth)().catch(() => false);
    res.json({
        status: dbHealthy ? 'ok' : 'degraded',
        service: 'security-service',
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
    console.log(`\n🛑 [security-service] Received ${signal}. Shutting down...`);
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
        console.log('🔄 Starting FuzeFront security-service...');
        const isProduction = process.env.NODE_ENV === 'production';
        // Original chain keeps the original knex_migrations table; dirs resolve to
        // THIS service's compiled output (dist/migrations) in prod, src in dev.
        await (0, core_1.initializeDatabase)({
            migrationsTableName: 'knex_migrations',
            migrationsDir: path_1.default.join(__dirname, 'migrations'),
            seedsDir: path_1.default.join(__dirname, 'seeds'),
        });
        try {
            console.log('🔧 Initializing OIDC service...');
            if (oidc_1.oidcService.isConfigured()) {
                await oidc_1.oidcService.initialize();
                console.log('✅ OIDC service initialized successfully');
            }
            else {
                console.log('⚠️  OIDC service not configured - local auth only');
            }
        }
        catch (error) {
            console.error('❌ Failed to initialize OIDC service:', error);
            console.log('⚠️  Continuing with local authentication only');
        }
        const portNumber = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
        httpServer.listen(portNumber, () => {
            console.log(`🚀 security-service running on port ${portNumber}`);
        });
    }
    catch (error) {
        console.error('❌ [security-service] Failed to start:', error);
        process.exit(1);
    }
}
startServer();
exports.default = app;
//# sourceMappingURL=index.js.map