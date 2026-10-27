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

// ---------------------------------------------------------------------------
// Transactional-outbox relay (events/outboxRelay.ts). Labels are bounded: `topic`
// is one of the ~15 selection-lists.* topics, `reason` one of two constants.
// Never an org/list/event id (cardinality is an availability concern).
// ---------------------------------------------------------------------------

export const outboxPublishedTotal = new client.Counter({
  name: 'selection_list_outbox_published_total',
  help: 'Outbox events published to Kafka',
  labelNames: ['topic'] as const,
  registers: [registry],
});

export const outboxPublishFailuresTotal = new client.Counter({
  name: 'selection_list_outbox_publish_failures_total',
  help: 'Outbox publish attempts that failed (the row stays pending and is retried)',
  labelNames: ['topic'] as const,
  registers: [registry],
});

export const outboxParkedTotal = new client.Counter({
  name: 'selection_list_outbox_parked_total',
  help: 'Outbox events parked as failed and copied to <topic>.dlq - ALERT on any increase',
  labelNames: ['topic', 'reason'] as const,
  registers: [registry],
});

export const outboxPendingGauge = new client.Gauge({
  name: 'selection_list_outbox_pending',
  help: 'Outbox rows waiting to be published',
  registers: [registry],
});

export const outboxOldestPendingAgeGauge = new client.Gauge({
  name: 'selection_list_outbox_oldest_pending_age_seconds',
  help: 'Age of the oldest pending outbox row (0 when none)',
  registers: [registry],
});

export const outboxFailedGauge = new client.Gauge({
  name: 'selection_list_outbox_failed',
  help: 'Outbox rows currently parked as failed (dead-lettered) - ALERT when > 0',
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Seed reconciler (seed/reconciler.ts). Labels are bounded constants (never an
// org id): `reason` is one of a handful of skip reasons, `retryable` is true/false.
// ---------------------------------------------------------------------------

export const reconcilerOrgsSeededTotal = new client.Counter({
  name: 'selection_list_seed_reconciler_orgs_seeded_total',
  help: 'Organizations the seed reconciler applied (or upgraded) platform defaults for',
  registers: [registry],
});

export const reconcilerSkippedFlagOffTotal = new client.Counter({
  name: 'selection_list_seed_reconciler_skipped_flag_off_total',
  help: 'Organizations the seed reconciler skipped because seeding is flagged OFF for them',
  registers: [registry],
});

export const reconcilerSkippedOtherTotal = new client.Counter({
  name: 'selection_list_seed_reconciler_skipped_total',
  help: 'Organizations the seed reconciler skipped for a reason other than the flag (backoff, locked, up-to-date, ...)',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const reconcilerFailedTotal = new client.Counter({
  name: 'selection_list_seed_reconciler_failed_total',
  help: 'Organizations whose reconcile attempt failed (backed off before the next try)',
  labelNames: ['retryable'] as const,
  registers: [registry],
});

export const reconcilerSweepsTotal = new client.Counter({
  name: 'selection_list_seed_reconciler_sweeps_total',
  help: 'Reconciler ticks finished, by result (ok | error)',
  labelNames: ['result'] as const,
  registers: [registry],
});

export const reconcilerLastSweepGauge = new client.Gauge({
  name: 'selection_list_seed_reconciler_last_sweep_timestamp_seconds',
  help: 'Unix time the last reconciler tick finished (0 = never)',
  registers: [registry],
});

// Seeded-list owner grants (docs/planning/selection-lists-events.md section 13.0.5): the org owner
// receives `list-owner` on the platform-seeded lists. `result` is one of granted | failed;
// `reason` is why a whole org was skipped (no-owner | no-seeded-lists | org-inactive). No org id.
export const ownerGrantsTotal = new client.Counter({
  name: 'selection_list_seed_owner_grants_total',
  help: 'list-owner grants on platform-seeded lists for the org owner, by result (granted | failed)',
  labelNames: ['result'] as const,
  registers: [registry],
});

export const ownerGrantSkippedTotal = new client.Counter({
  name: 'selection_list_seed_owner_grant_skipped_total',
  help: 'Organizations for which the seeded-list owner grant was skipped, by reason (no-owner | no-seeded-lists | org-inactive)',
  labelNames: ['reason'] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Authorization-authority consistency (review M-2 / L-5). `selection_list_access` is a
// read-model mirror; the Security API is the authority. These counters make every way the
// two can diverge (or be repaired) visible. Labels are bounded constants, never an id.
// ---------------------------------------------------------------------------

/** A compensating Security API write after a failed access change. */
export const authzCompensationTotal = new client.Counter({
  name: 'selection_list_authz_compensation_total',
  help: 'Compensating Security API writes after a failed PUT/DELETE access change, by op (put | delete) and outcome (restored | failed). ALERT on outcome="failed": the authority and the mirror now disagree.',
  labelNames: ['op', 'outcome'] as const,
  registers: [registry],
});

/** The mirror says list-owner, the authority says that user cannot manage_access. */
export const ownerDriftTotal = new client.Counter({
  name: 'selection_list_owner_drift_total',
  help: 'Mirror rows claiming list-owner that the Security API does not confirm (seen by the last-owner guard)',
  registers: [registry],
});

/** A list was left with no list-owner by a cascade (a deleted user was its last owner). */
export const ownerlessListsTotal = new client.Counter({
  name: 'selection_list_ownerless_lists_total',
  help: 'Lists left with zero list-owners by a cascade, by cause (user_deleted). ALERT on any increase: recovery is a tenant admin granting list-owner via the Security API.',
  labelNames: ['cause'] as const,
  registers: [registry],
});

/** Best-effort Security API grant cleanup that did not complete (purge / user deletion). */
export const grantCleanupFailedTotal = new client.Counter({
  name: 'selection_list_grant_cleanup_failed_total',
  help: 'Security API grant revocations that failed during a cascade, by cause (purge | user_deleted). Orphan role assignments remain until reconciled.',
  labelNames: ['cause'] as const,
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
