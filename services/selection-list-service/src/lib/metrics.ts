// lib/metrics.ts — Prometheus metrics for selection-list-service.
//
// Exposed at GET /metrics (unauthenticated like /health, scraped in-cluster via
// the prometheus.io/* pod annotations the Helm chart already sets; the ingress
// publishes only /api/v1/selection-lists and /api/v1/resolve, so /metrics is
// never reachable from outside the cluster).
//
// Contents: prom-client default process/Node metrics + ONE request histogram,
// `http_request_duration_seconds{method,route,status_code}`.
//
// Cardinality is an availability concern (every distinct label value mints a
// time series): `route` is the MATCHED route PATTERN (`/v1/selection-lists/:listId/items`),
// never the raw URL, so ids cannot leak into labels; a request that matched no
// route (404 probes, scanners, auth failures at the /v1 gate) collapses to the
// constant "unmatched". No user/org/list ids are ever labels.

import client from 'prom-client';
import type { NextFunction, Request, Response } from 'express';

export const registry = new client.Registry();
registry.setDefaultLabels({ service: 'selection-list-service' });
client.collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  // 1ms -> 5s: a DB-backed JSON API; resolve is the hot path.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

/** Low-cardinality route label: the matched pattern, or "unmatched". */
export function routeLabel(req: Request): string {
  const matched = req.route && typeof req.route.path === 'string' ? req.route.path : null;
  if (!matched) return 'unmatched';
  const label = `${req.baseUrl ?? ''}${matched}`;
  return label === '' ? '/' : label;
}

/** Records one observation per finished request (the scrape endpoint itself excluded). */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/metrics') {
    next();
    return;
  }
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: routeLabel(req), status_code: String(res.statusCode) });
  });
  next();
}

/** Prometheus text exposition of the registry. */
export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  return { contentType: registry.contentType, body: await registry.metrics() };
}
