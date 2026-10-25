# Changelog — @fuzefront/telemetry

All notable changes to this package are documented here. Versioned
independently — bump on every interface change (SemVer).

## 0.2.0 — browser real-user monitoring (RUM)

### Added

- `@fuzefront/telemetry/browser` now exports `initBrowserRum()` (observability-
  standard P31–P36): Core Web Vitals (LCP, CLS, INP, TTFB, FCP) via the new
  `web-vitals` dependency; navigation timing and slow/failed resource timing via
  `PerformanceObserver`; uncaught errors + unhandled rejections (via
  `addEventListener`, so existing handlers are not clobbered); and a leveled
  `logger` (`error`/`warn`/`info`/`debug`) for deliberate structured client logs.
- Events are batched and shipped with `navigator.sendBeacon` (fallback
  `fetch` + `keepalive`) to the same-origin `/api/v1/rum` (override with
  `endpoint`), each tagged with the active `trace_id`/`span_id`, a stable
  per-tab `session_id` (sessionStorage, in-memory fallback), the app `release`,
  and the route (pathname only).
- Client-side token-bucket rate limit (`maxEventsPerMinute`), batch cap, and
  session-level `sampleRate` (errors and warn/error logs are never
  session-sampled); secrets/PII redacted (key- and value-based; URLs lose
  query/hash). Everything is fail-open: telemetry never throws into the app.
- Exported helpers: `getRumSessionId`, `redactString`, `redactAttrs`,
  `sanitizeUrl`, `sendRumPayload`; `getActiveTraceId`/`getActiveSpanId` moved
  to `rum-trace.ts` (still exported from `/browser`, no API change).

### Changed

- New runtime dependency: `web-vitals` (browser entry only; the Node entry and
  the browser bundle still pull no Node-only OTel package).
- Consumers' range moves to `^0.2.0` (`0.x` MINOR is not covered by `^0.1.0`).

## 0.1.6 — a bare RegExp route.path no longer crashes the req.route setter

### Fixed

- Express also supports a single `RegExp` as a route pattern (`app.get(/^\/files\//,
  ...)`), assigning it directly to `req.route.path` — not wrapped in an array.
  0.1.5's `selectRoutePath()` treated anything that wasn't a string as an
  array and called `.find()`/`.join()` on it, which crashed the `req.route`
  setter (and therefore the request) for any RegExp-registered route before
  its handler ever ran. Caught by a Codex review on PR #1489, immediately
  after 0.1.5 shipped. Fixed by checking for `instanceof RegExp` explicitly
  and using its own `.toString()` as a deterministic, bounded span name —
  same philosophy as the array fallback. A RegExp mixed into an array of
  candidates already stringified correctly via `.join()`, so only the
  bare-RegExp (non-array) case needed the extra check. Verified against a
  real Express app with a genuine `app.get(/^\/files\//, ...)` route (confirmed
  it crashes without the fix, returns 200 with it) plus a new regression test.

## 0.1.5 — array route paths (Express multi-path registration) no longer coerce to a comma-joined string

### Fixed

- `req.route.path` is the raw ARRAY as given when a handler is registered
  with multiple patterns in one call (e.g. `app.get(['/ready', '/api/ready'],
  ...)` — the host backend's own pattern), not whichever entry actually
  matched the request; confirmed empirically against a real Express app that
  it stays the full array for either matching request. The span-naming and
  `http.route` code interpolated this value into a template string, which
  silently coerced the array via `Array.prototype.toString()` into the
  nonsensical `GET /ready,/api/ready` — an invalid route for either actual
  endpoint — for EVERY request to either path. Caught by a Codex review on
  PR #1489. Fixed by selecting the array entry that exactly matches `req.path`
  (the same router-local scope every other array entry lives in); a
  parameterized alternate with no exact match falls back to a `|`-joined
  name, which stays deterministic and bounded (one name per route
  REGISTRATION, not per request) without adding a path-to-regexp dependency.
  Verified with two new regression tests (the static-array exact-match case
  mirroring the reported bug, and the parameterized-fallback case).

## 0.1.4 — two regressions from 0.1.3's req.route accessor, both caught by Codex

### Fixed

- The 0.1.3 `req.route` accessor initialized its backing value to
  `undefined` unconditionally, discarding an ALREADY-matched route when
  `tracingMiddleware()` is mounted per-router, after matching — the
  documented supported usage (see `TracingMiddlewareOptions.spanName`).
  Every downstream handler then saw `req.route` as undefined, and the
  completion callback renamed an otherwise-correct span to
  `METHOD (unmatched)`. Fixed by seeding the accessor from whatever
  `req.route` already holds before installing it. Verified against a
  real Express app with `tracingMiddleware()` as a route-level handler
  after an `app.get('/:id', ...)` param match.
- The unmatched-request fallback (`METHOD (unmatched)`, 0.1.2) applied
  unconditionally, overriding a caller-supplied `options.spanName` for
  exactly the requests its own naming contract is documented to cover.
  Fixed: the fixed fallback name now only applies when using the
  default naming function; a custom `spanName` is honored for the
  unmatched case too, same as the matched case already was.

## 0.1.3 — matched-route snapshot survives error-forwarding out of a nested router

### Fixed

- `tracingMiddleware()` recomputed `req.baseUrl + req.route.path` lazily at
  response-end. When a handler inside a mounted `Router` calls `next(err)`
  to escape it, Express restores `req.baseUrl` to the OUTER scope's value
  while unwinding, but leaves `req.route` pointing at the INNER router's
  (now mismatched) route — verified empirically against real Express.
  Recombining them live then paired an unwound `baseUrl` with a
  `route.path` from a different scope, under-reporting the span name and
  `http.route` for every 5xx that error-forwards this way — exactly where
  accurate attribution matters most. Caught by a Codex review on PR #1489.
  Fixed by snapshotting `baseUrl + route.path` the instant Express sets
  `req.route` (intercepting that assignment via a property accessor),
  rather than reading both lazily later. Verified against both the mocked
  unit test and a real Express app with a genuine nested-router
  `next(err)` path.

## 0.1.2 — span names include the router mount prefix; unmatched requests no longer leak the raw path; Express 5 peer range restored

### Fixed

- An unmatched request (rejected before the router ran, e.g. a malformed-JSON
  body-parser failure; or a genuine 404) never got `req.route` set, so
  `tracingMiddleware()` kept the span's initial name — the raw, attacker-
  controlled `req.path` — for its entire lifetime, and the `http.route`
  attribute echoed it too. An adversary probing arbitrary/random paths could
  create unbounded Tempo operation names, the exact cardinality problem the
  matched-route rename (0.1.1) exists to prevent for parameterized routes.
  Caught by a Codex review on PR #1489. Fixed: when no route ever matches,
  the span is renamed to a fixed `METHOD (unmatched)` and `http.route` is
  omitted rather than set to the raw path.
- `peerDependencies.express` regressed back to `^4.22.2`-only on this
  branch (it forked before `fix/telemetry-express-5-peer-range` / PR #1487
  merged, and that PR's Express 5 widening never landed here). Caught by a
  Codex review once this version was newly wired into `payment-service`,
  which runs Express 5. Restored to `^4.22.2 || ^5.0.0`.
- `tracingMiddleware()` renamed a matched request's span using only
  `req.route.path`, which is the pattern LOCAL to whichever `Router` matched
  it — dropping the mount prefix (`req.baseUrl`) entirely. Two different
  mounted routers' equally-shaped inner routes (e.g. `GET /docs/` and
  `GET /v1/selection-lists/`) collapsed to the same span name `GET /`.
  Caught by a Codex review on PR #1489. Fixed by combining `req.baseUrl` +
  `req.route.path` wherever a matched route name is derived — both the
  default `spanName()` and the `http.route` attribute.

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
