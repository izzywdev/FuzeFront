# Changelog — @fuzefront/telemetry

All notable changes to this package are documented here. Versioned
independently — bump on every interface change (SemVer).

## 0.1.1 — tracingMiddleware() ends streaming spans on `close`, not just `finish`

> This branch forked before `fix/telemetry-express-5-peer-range` (PR #1487,
> also bumping to 0.1.1 — the Express 5 peer-range widen) merged. If that
> lands first, resolving the conflict on this file means **both** changes
> ship, at 0.1.2 — not picking one over the other.

### Fixed

- `tracingMiddleware()` only ended its span on the response's `finish`
  event. A long-lived streaming response (SSE, chunked keep-alive) never
  calls `res.end()` itself, so `finish` never fires — the span, and
  everything nested under it, never ended and was never exported. Surfaced
  wiring the middleware into `notification-service`'s `/stream` SSE route
  during the fleet-wide OTel rollout (PR #1489). Fixed by also ending on
  `close` (which fires on both a normal completed response, after
  `finish`, and an abrupt client disconnect), guarded so a normal request —
  where both events now fire — ends its span exactly once.

## 0.1.0 — Initial implementation

Phases 1–3 of the OpenTelemetry distributed-tracing initiative: a Node SDK
entry, a browser SDK entry, and correlation with the family pino
structured-logging standard (`.claude/skills/logging/SKILL.md`).

### Added

- **Node entry (`@fuzefront/telemetry`)**:
  - `initTelemetry(options)` — bootstraps `@opentelemetry/sdk-node` with
    `HttpInstrumentation` + `ExpressInstrumentation` (not the
    `auto-instrumentations-node` meta-package — see `docs/TRACE_CONTRACT.md
    #why-not-the-meta-package`). Selectable OTLP transport (`grpc` default via
    `@opentelemetry/exporter-trace-otlp-grpc`, or `http` via
    `@opentelemetry/exporter-trace-otlp-http`), env-driven config resolution
    matching `backend/security/src/config/*`'s `process.env.X || 'default'`
    convention, and a `sampleRatio` option (default `1`, sample everything,
    with a `ParentBasedSampler` so a continued trace is never fragmented).
  - `tracingMiddleware()` — Express middleware; starts/continues a per-request
    SERVER span from an inbound W3C `traceparent`, exposes `req.traceId`/
    `req.spanId`. Deliberately never reads/writes `req.reqId`/`req.requestId`/
    `x-request-id` — see the middleware's own doc comment and
    `docs/TRACE_CONTRACT.md#log-correlation-fields` for how this coexists with
    the logging skill's `reqId` convention instead of competing with it.
  - `withTraceContext(logger, req)` — binds `trace_id`/`span_id` onto a pino
    (or pino-shaped) child logger. Returns the logger unchanged for an
    untraced request. Structurally typed (`ChildCapableLogger`) — no hard
    dependency on `pino`.
- **Browser entry (`@fuzefront/telemetry/browser`)**:
  - `initBrowserTelemetry(options)` — `@opentelemetry/sdk-trace-web` +
    OTLP/HTTP export (browsers cannot speak gRPC) + `fetch`/`XHR`
    instrumentation, which stamps `traceparent` on outgoing requests to
    configured origins (default: same-origin only, matching FuzeFront's
    same-origin API-base convention).
  - `getActiveTraceId()` / `getActiveSpanId()` / `tagWithTraceContext(fields)`
    — tag client-side error/log payloads with the active trace id, mirroring
    the Node entry's `withTraceContext`.
  - `injectTraceHeaders()` — manual `traceparent` injection for outbound calls
    the fetch/XHR instrumentation doesn't cover.
- 46 unit tests across both entries (config resolution/precedence, exporter
  selection, middleware header precedence/continuation, logging-integration
  field binding, browser trace-context helpers). No live collector round
  trip — FuzeInfra's collector isn't reachable from this repo's CI/dev
  environment; see each test file's header comment for what it verifies
  instead.
- `docs/TRACE_CONTRACT.md` — full usage + wire contract for both entries,
  referencing FuzeInfra's `docs/consuming-repos/OBSERVABILITY_DASHBOARDS.md`.

### Notes

- OTel package versions were checked against the npm registry at
  implementation time (2026-09-27) rather than assumed — see
  `docs/TRACE_CONTRACT.md#dependency-versions` for the exact versions and
  the note on re-verifying them before this package's first real publish
  (OTel JS churns quickly; by publish time newer patch/minor releases may
  exist).
