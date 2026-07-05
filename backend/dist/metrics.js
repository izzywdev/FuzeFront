"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupMetrics = setupMetrics;
function noopMetrics() {
    return {
        middleware: (_req, _res, next) => next(),
        registerEndpoint: app => {
            app.get('/metrics', (_req, res) => {
                res
                    .status(503)
                    .type('text/plain')
                    .send('# prom-client not installed; metrics unavailable\n');
            });
        },
    };
}
function setupMetrics() {
    let client;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        client = require('prom-client');
    }
    catch {
        console.warn('⚠️ prom-client not installed — /metrics will return 503');
        return noopMetrics();
    }
    const register = new client.Registry();
    register.setDefaultLabels({ service: 'fuzefront-backend' });
    client.collectDefaultMetrics({ register });
    const httpRequestDuration = new client.Histogram({
        name: 'http_request_duration_seconds',
        help: 'Duration of HTTP requests in seconds',
        labelNames: ['method', 'route', 'status_code'],
        // Buckets tuned for a web API (1ms → 5s).
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
        registers: [register],
    });
    const httpRequestsTotal = new client.Counter({
        name: 'http_requests_total',
        help: 'Total number of HTTP requests',
        labelNames: ['method', 'route', 'status_code'],
        registers: [register],
    });
    return {
        middleware: (req, res, next) => {
            // Skip the scrape endpoint itself to avoid self-referential noise.
            if (req.path === '/metrics')
                return next();
            const end = httpRequestDuration.startTimer();
            res.on('finish', () => {
                // Prefer the matched route pattern (low cardinality); fall back to path.
                const route = (req.route && req.route.path) ||
                    (req.baseUrl ? `${req.baseUrl}` : req.path) ||
                    'unknown';
                const labels = {
                    method: req.method,
                    route,
                    status_code: String(res.statusCode),
                };
                end(labels);
                httpRequestsTotal.inc(labels);
            });
            next();
        },
        registerEndpoint: app => {
            app.get('/metrics', async (_req, res) => {
                try {
                    res.set('Content-Type', register.contentType);
                    res.end(await register.metrics());
                }
                catch (err) {
                    res.status(500).end(String(err));
                }
            });
        },
    };
}
//# sourceMappingURL=metrics.js.map