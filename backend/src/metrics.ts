// Prometheus metrics (Phase E). Exposes a /metrics endpoint scraped by the
// FuzeInfra Prometheus via the prometheus.io/* pod annotations set in the Helm
// chart. Uses prom-client default process/Node metrics plus a per-request HTTP
// histogram (drives the 5xx-rate + latency alert rules).
//
// Defensive: if prom-client is not installed the module degrades to a no-op so
// the backend still boots (mirrors the optional-require pattern used for Swagger).
import type { Express, Request, Response, NextFunction } from 'express'

// Prometheus label cardinality is an availability concern: every distinct label
// value mints a new time series, and a label fed from a user-controlled URL
// grows that set without bound until the scraper OOMs. Any path segment that
// looks like an identifier is therefore collapsed to ":id" before it is used as
// a label value.
const ID_SEGMENT =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z][a-z0-9]*_[0-9a-hjkmnp-tv-z]{26}|[0-9a-fA-F]{16,}|[^/]{24,})$/

function normalizeRouteLabel(p: string): string {
  return p
    .split('/')
    .map(seg => (ID_SEGMENT.test(seg) ? ':id' : seg))
    .join('/')
}

interface MetricsHandle {
  /** Express middleware that records request count + duration. */
  middleware: (req: Request, res: Response, next: NextFunction) => void
  /** Registers GET /metrics on the app. */
  registerEndpoint: (app: Express) => void
}

function noopMetrics(): MetricsHandle {
  return {
    middleware: (_req, _res, next) => next(),
    registerEndpoint: app => {
      app.get('/metrics', (_req, res) => {
        res
          .status(503)
          .type('text/plain')
          .send('# prom-client not installed; metrics unavailable\n')
      })
    },
  }
}

export function setupMetrics(): MetricsHandle {
  let client: any
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    client = require('prom-client')
  } catch {
    console.warn('⚠️ prom-client not installed — /metrics will return 503')
    return noopMetrics()
  }

  const register = new client.Registry()
  register.setDefaultLabels({ service: 'fuzefront-backend' })
  client.collectDefaultMetrics({ register })

  const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    // Buckets tuned for a web API (1ms → 5s).
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  })

  const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  })

  return {
    middleware: (req, res, next) => {
      // Skip the scrape endpoint itself to avoid self-referential noise.
      if (req.path === '/metrics') return next()
      const end = httpRequestDuration.startTimer()
      res.on('finish', () => {
        // Prefer the matched route pattern (low cardinality). NEVER fall back to
        // req.path: it is raw user input, so unmatched requests (404 probes)
        // would mint one Prometheus series per distinct URL. Unmatched requests
        // collapse to the constant "unmatched"; the router mount prefix is
        // normalised in case a router is mounted under a parameterised path.
        const matchedPath =
          req.route && typeof req.route.path === 'string' ? req.route.path : null
        const base = req.baseUrl ? normalizeRouteLabel(req.baseUrl) : ''
        const route = matchedPath
          ? `${base}${matchedPath}` || 'unknown'
          : base || 'unmatched'
        const labels = {
          method: req.method,
          route,
          status_code: String(res.statusCode),
        }
        end(labels)
        httpRequestsTotal.inc(labels)
      })
      next()
    },
    registerEndpoint: app => {
      app.get('/metrics', async (_req, res) => {
        try {
          res.set('Content-Type', register.contentType)
          res.end(await register.metrics())
        } catch (err) {
          // Log the full error (incl. stack) server-side only; the response body
          // stays generic so internal details are never exposed to the scraper
          // or to anyone else who can reach the endpoint.
          console.error('Failed to collect Prometheus metrics:', err)
          res
            .status(500)
            .type('text/plain')
            .end('# metrics collection failed\n')
        }
      })
    },
  }
}
