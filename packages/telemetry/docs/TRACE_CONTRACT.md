# `@fuzefront/telemetry` — Trace & Log-Correlation Contract

This document freezes the wire contract this package implements against
FuzeInfra's collector, and the in-process contract between this package and
the family's pino structured-logging standard
(`.claude/skills/logging/SKILL.md`). It is the FuzeFront-side counterpart to
FuzeInfra's own **`docs/consuming-repos/OBSERVABILITY_DASHBOARDS.md`** (not
available in this repo — FuzeInfra is a sibling repo; the summary below is
everything this package was built against).

> **Upstream context.** FuzeInfra stood up Grafana Tempo + an OpenTelemetry
> Collector as prod infra. Before this package, it received zero trace data —
> nothing in the product fleet sent OTLP. This package is the first sender.

## Transport

Apps send OTLP **to the Collector, never directly to Tempo/Loki**:

| Deployment target | Endpoint | Protocol |
| --- | --- | --- |
| In-cluster k8s (prod) | `http://fuzeinfra-otel-collector.fuzeinfra:4317` | gRPC |
| docker-compose (local dev) | `http://otel-collector:4317` | gRPC |
| Either, when gRPC egress is blocked | same host, port `4318` | HTTP |
| Browser | same-origin `/v1/traces` (reverse-proxied to the collector's HTTP receiver) | HTTP only — browsers cannot speak gRPC |

Both gRPC (`@opentelemetry/exporter-trace-otlp-grpc`) and HTTP
(`@opentelemetry/exporter-trace-otlp-http`) are supported on the Node side,
selectable via `TelemetryOptions.protocol` — not every deployment target
reaches gRPC (a raw HTTP/2 connection) equally; some k8s `NetworkPolicy`s or
egress proxies allow plain HTTP but block it. The browser entry has no
`protocol` option: it always uses HTTP.

### Env var resolution (matches `backend/security/src/config/*`)

`initTelemetry` follows the same `process.env.X || 'default'` convention as
`backend/security/src/config/permit.ts` / `database.ts` — read the standard
OTel env var, fall back to a package default, never throw on a missing
optional value:

| Option | Env var | Default |
| --- | --- | --- |
| `otlpEndpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` (grpc) / `:4318` (http) |
| `protocol` | `OTEL_EXPORTER_OTLP_PROTOCOL` (`grpc`\|`http/protobuf`\|`http/json`) | `grpc` |
| `sampleRatio` | `OTEL_TRACES_SAMPLER_ARG` (0..1) | `1` |
| `headers` | `OTEL_EXPORTER_OTLP_HEADERS` (`k1=v1,k2=v2`) | none |

An explicit option **always wins over the environment**, same as an explicit
`createVerifier` config option would win in `@fuzefront/auth`. Production/k8s
sets `OTEL_EXPORTER_OTLP_ENDPOINT` explicitly via Helm to the in-cluster
address above — this package does **not** hardcode that cluster-internal DNS
name as a fallback default (only the docker-compose-local address is a
built-in default, mirroring `PERMIT_PDP_URL`'s `http://localhost:7766`
pattern).

## Why not `@opentelemetry/auto-instrumentations-node`

That meta-package wires ~15 instrumentations (`pg`, `redis`, `mongodb`,
`graphql`, `aws-sdk`, `dns`, `net`, …). No FuzeFront service uses more than a
couple of these today, and pulling every one of them in would multiply this
package's install size and its exposure to instrumentation bugs in modules
nothing here even calls. `initTelemetry` wires exactly `HttpInstrumentation` +
`ExpressInstrumentation` — the two every Express-based FuzeFront service
needs — and takes an `instrumentations` option to add more as a concrete need
appears (e.g. `PgInstrumentation` once a service wants outbound Postgres query
spans).

## Sampling

Default `sampleRatio: 1` — sample everything — while the collector pipeline
is being validated fleet-wide (this is the FIRST sender; there's nothing to
tune against yet). `initTelemetry` wraps the ratio sampler in a
`ParentBasedSampler`, so:

- A **root** span (no valid parent context — a new trace) is sampled per
  `sampleRatio`.
- A **child** span (continuing an inbound `traceparent`) always inherits its
  parent's decision, regardless of `sampleRatio`. This is what makes lowering
  `sampleRatio` later safe: it thins out which NEW traces start, but a trace
  already being recorded upstream is never fragmented by a downstream
  service's own ratio.

## Log-correlation fields

The three-pillar contract: **every log line emitted during a traced request
must include that request's `trace_id`** (and ideally `span_id`), so Loki log
lines link to Tempo traces and vice versa. This package's half of that
contract:

- `tracingMiddleware()` sets `req.traceId` / `req.spanId` (camelCase, Express
  convention, matching `req.requestId`/`req.reqId`'s own casing).
- `withTraceContext(logger, req)` binds them onto the log line as
  **`trace_id`** / **`span_id`** (snake_case) — the OTel log-correlation
  field-naming convention (matching what Grafana's Loki<->Tempo derived-field
  wiring expects), deliberately distinct from the family's own camelCase
  `reqId` convention. The two conventions coexist on the same child logger
  rather than one renaming the other:

  ```json
  {"level":30,"time":...,"reqId":"a1b2c3d4","trace_id":"4bf92f...4736","span_id":"00f067...02b7","msg":"request completed"}
  ```

### How this agrees with `reqId` instead of fighting it

The logging skill's reference `requestLogger` (`.claude/skills/logging/
SKILL.md` §4/§8) assigns `reqId` from an inbound `x-request-id` header,
falling back to a generated UUID. `tracingMiddleware()` **never reads or
writes `req.reqId` / `req.requestId`, and never looks at `x-request-id`**. It
owns exactly one header (`traceparent` + `tracestate`) and exactly two fields
(`req.traceId` / `req.spanId`). If a caller sends both `x-request-id` and
`traceparent`, both are honored independently — there is no precedence
conflict because neither middleware inspects the other's header.

Why keep both rather than merging them into one id:

- `reqId` is FuzeFront-local: always present (generated if absent),
  greppable within **one service's** logs.
- `trace_id`/`span_id` are OTel ids that continue **across services** as
  `traceparent` propagates hop to hop — which plain `reqId` propagation (the
  logging skill's manual outbound-header pattern) does by copying a value, not
  by the receiving service being able to verify or extend a real span tree.

Mount both middlewares and bind both fields on the child logger (see the
updated §8 reference in `.claude/skills/logging/SKILL.md`).

## Browser transport

The browser entry defaults `otlpEndpoint` to the same-origin relative path
`/v1/traces`, matching the root `CLAUDE.md`'s "same-origin API base" rule for
the frontend shell (never a hardcoded absolute host, so it works identically
under local TLS and prod ingress). This assumes the host's ingress/nginx
proxies `/v1/traces` through to the Collector's HTTP receiver — **that ingress
passthrough is FuzeInfra/ops work, out of this package's scope.** Until it's
wired, pass an explicit `otlpEndpoint` (e.g. a directly-reachable collector
HTTP URL for a non-prod environment) to `initBrowserTelemetry`.

`propagateTraceHeaderCorsUrls` (which origins get `traceparent`/`tracestate`
attached to outgoing `fetch`/`XHR` calls) defaults to same-origin only, for
the same reason — attaching a `traceparent` header to a cross-origin request
the target hasn't allow-listed via CORS breaks the request, not just the
trace.

## Browser context manager

`initBrowserTelemetry` leaves the context manager at its `WebTracerProvider`
default (`StackContextManager`). A `ZoneContextManager` (from
`@opentelemetry/context-zone`, which needs the `zone.js` peer) tracks async
control flow more reliably across event-loop ticks (e.g. inside a `then()`
chain spanning a macrotask) — this package does not pull it in by default to
avoid the extra peer dependency for every consumer, most of whose `fetch`/
`XHR` spans complete within a single tick's context anyway. An app with async
flows `StackContextManager` can't track should register `ZoneContextManager`
itself: `provider.register({ contextManager: new ZoneContextManager(), propagator: new W3CTraceContextPropagator() })`,
replacing this package's own `provider.register()` call — i.e. call
`initBrowserTelemetry` for the exporter/instrumentation wiring, but be aware
it already registers a propagator+default context manager, so a consumer
wanting Zone-based context needs to construct the provider manually instead
of through `initBrowserTelemetry` today. This is a documented v0.1 gap, not a
silent one.

## Dependency versions

Checked against the npm registry on 2026-09-27 (real published versions, not
guessed): `@opentelemetry/api` 1.9.1; `@opentelemetry/sdk-node`,
`exporter-trace-otlp-grpc`, `exporter-trace-otlp-http`, `instrumentation`,
`instrumentation-http`, `instrumentation-fetch`,
`instrumentation-xml-http-request` at 0.222.0; `instrumentation-express` at
0.70.0; `sdk-trace-base`, `sdk-trace-web`, `resources`, `core` at 2.11.0;
`semantic-conventions` at 1.43.0. **Re-verify these before this package's
first real `npm publish`** — the OTel JS SDK ships frequently, and a newer
compatible release may exist by then. All are pinned with `^` (caret) ranges,
matching `packages/auth`'s convention, which for a `0.x` package restricts to
patch-level bumps only (the safe default for pre-1.0 packages that reserve
the right to break on minor).

## Testing without a live collector

None of this package's tests reach a real OTel Collector (not reachable from
this repo's dev/CI environment). Instead:

- `config.test.ts` / `exporter.test.ts` — assert `resolveTelemetryConfig`'s
  precedence/defaulting and `createTraceExporter`'s exporter-class selection
  as pure unit tests, no SDK started.
- `init.test.ts` — starts a real `NodeSDK` (so instrumentation wiring is
  exercised for real) but only asserts `handle.config`, and shuts down before
  any span is ever created — nothing is queued to export, so no network
  attempt happens.
- `middleware.test.ts` — a real `BasicTracerProvider` +
  `InMemorySpanExporter` + `AsyncHooksContextManager`, asserting header
  precedence/continuation and context propagation against actually-recorded
  `ReadableSpan`s.
- `logging.test.ts` — a real `pino` logger writing to an in-memory
  `stream.Writable`, asserting the exact JSON fields on the log line.
- `browser.test.ts` — a real `WebTracerProvider` with a `NoopSpanProcessor`
  (deliberately not the real OTLP/HTTP exporter `initBrowserTelemetry` wires —
  see that file's header comment for why: Jest's `jsdom` environment doesn't
  do bundler-style "browser" module resolution, so the exporter's Node
  transport code path would run and attempt a real dynamic import
  Jest can't satisfy without `--experimental-vm-modules`).
