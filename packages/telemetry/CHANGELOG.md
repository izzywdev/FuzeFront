# Changelog — @fuzefront/telemetry

All notable changes to this package are documented here. Versioned
independently — bump on every interface change (SemVer).

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
