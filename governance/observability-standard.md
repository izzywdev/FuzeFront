# Observability standard — logging, tracing, metrics, RUM

**Status of this document:** canonical, enumerated policy for the whole Fuze family.
**Owner:** `platform-governance` (policy) · `backend-engineer` / `frontend-engineer` (implement) · the reviewer (enforce).
**Companion skill:** `.claude/skills/logging/SKILL.md` is the *how-to* (copy-paste pino setup, the incident that wrote it). This document is the *what-and-whether*: the full policy list, each tagged with where we are today.

This standard exists because "it has telemetry" is not one question. A service can export traces and still be unloggable; a frontend can propagate `traceparent` and still give you nothing when a user says "the page was slow." The three pillars — **logs** (Loki), **traces** (Tempo), **metrics** (Prometheus) — plus **RUM** (real-user monitoring in the browser) are separate obligations, and a coding agent needs to know which are mandatory, which are wired, and which are still a gap. Each policy below carries one of:

- ✅ **HAVE** — implemented and in force today (named where).
- 🟡 **PARTIAL** — implemented for some services/paths, not all; the ratchet is still climbing.
- ❌ **GAP** — not implemented; this is work to be done. The build plan in §13 sequences the gaps.

The platform stack these policies target is FuzeInfra's: an **OTel Collector** (traces + OTLP), **Grafana Tempo** (traces), **Loki** (logs), **Prometheus + Grafana** (metrics + dashboards). Apps never write to Tempo/Loki/Prometheus directly — they emit stdout JSON (scraped), OTLP to the Collector, and a Prometheus `/metrics` endpoint (scraped). FuzeInfra's `docs/consuming-repos/OBSERVABILITY_DASHBOARDS.md` is the upstream contract.

---

## 1. Structured logging — the shared logger

- **P1. One shared structured logger per service, never `console.*` in new code.** Node uses [`pino`](https://getpino.io) emitting JSON to stdout; one `src/lib/logger.ts` root logger, everything else a child of it. ✅ HAVE (Node; standard in the logging skill, adopted critical-path-first).
- **P2. JSON to stdout only — no file logging, no log shipping from the app.** The platform scrapes stdout into Loki; an app that writes files or ships logs itself is misconfigured. ✅ HAVE (Node).
- **P3. Legacy `console.*` is migrated to the shared logger opportunistically, and new code ships zero raw `console.*`.** A standing cleanup ticket tracks the long tail; the no-new-`console.*` rule is the ratchet. 🟡 PARTIAL (new-code rule in force; the ~210-call legacy tail in `backend/security` and others is not fully migrated).
- **P4. Python services use one shared structured-JSON logger with the identical field contract** (`structlog` or `python-json-logger`, same level names, same `reqId`/`trace_id`/`span_id` keys as Node). ❌ GAP (no Python logging standard or shared module exists; see P27–P30).
- **P5. The log record schema is stable and documented** — `level`, `time` (ISO), `service`, `msg`, plus the correlation fields. Renaming a field is a breaking change to every Loki query and dashboard. 🟡 PARTIAL (Node shape is consistent in practice; it is not written down as a schema or gated).

## 2. Levels and runtime control

- **P6. Verbosity is controlled by `LOG_LEVEL` read at startup; prod default `info`.** Debugging a live incident is `LOG_LEVEL=debug` + restart, never a code change or redeploy. ✅ HAVE (Node).
- **P7. Level semantics are fixed: ERROR = failed, needs attention; WARN = degraded but handled; INFO = flow milestones (prod-safe volume); DEBUG = per-hop detail + timing, off in prod.** ✅ HAVE (documented; enforced on review).
- **P8. INFO tells the story, DEBUG tells the timing and the why.** If you'd want it at 2am but not in steady-state noise, it is DEBUG. ✅ HAVE (guidance).
- **P9. A runtime level-change endpoint (flip to debug without a pod restart) is available on each service.** ❌ GAP (today debugging requires a restart; no `/admin/loglevel` or signal handler is standard).

## 3. Boundary and error logging

- **P10. Every external call logs start + end + elapsed ms.** External = any hop out of the process: HTTP to another service/provider (Authentik, Permit, Stripe, Unleash), DB query, Redis op, Kafka produce/consume, filesystem/network. This is the rule that turned "login hangs" into "authorize() took 6512ms." ✅ HAVE (standard; the `timed()` helper in the skill).
- **P11. Every `catch` logs the error with context — never `catch {}`, never rethrow-silent.** Log the error object, the operation, and identifying context (`reqId`, `userId`/`orgId`, resource id, upstream status). ✅ HAVE (standard; reviewer-enforced on auth/payment).
- **P12. Critical-path decision branches are observable, including the fail-closed cases** (reveal-once token already revealed; remove-last-2FA-factor → 409; demote-the-last-admin; `hasPassword: null`). Log the input that drove the branch and which branch was taken. ✅ HAVE (standard).
- **P13. Every HTTP request is logged at entry and exit with method, route, status, and elapsed ms — by middleware, not per-handler.** This is the API-entrance/exit requirement: one middleware mounted once per service. ✅ HAVE (Node; `requestLogger` + `tracingMiddleware` mounted via `backend/core` bootstrap and each service `app.ts`).
- **P14. The request log uses the matched route template, never the raw path** (`/users/:id`, not `/users/42`), to bound Loki/Tempo cardinality. ✅ HAVE (the telemetry middleware's `selectRoutePath()` after the 0.1.5/0.1.6 fixes).
- **P15. No log line is emitted inside a tight loop or per-row of a large result set.** Summarize (`rows=N`), do not narrate each row. 🟡 PARTIAL (guidance, not gated).

## 4. Correlation

- **P16. Every request carries a `reqId`** — accept inbound `x-request-id` else generate a UUID — bound as a child-logger field at entry and used for the whole request. One request = one greppable thread. ✅ HAVE (Node).
- **P17. `reqId` is propagated to downstream calls** as an outbound `x-request-id` header so the next service's logs join the same thread. ✅ HAVE (standard; per-call on critical paths).
- **P18. Stable request-scoped context (`userId`, `orgId`/tenant, route) is bound once on the child logger**, not repeated per line. ✅ HAVE (standard).
- **P19. Every log line emitted during a traced request carries that request's `trace_id` (and `span_id`), snake_case, alongside `reqId`.** This is what links a Loki line to its Tempo trace. ✅ HAVE (Node; `withTraceContext`, now that `initTelemetry` is wired in every service).
- **P20. `trace_id` is the cross-service join key; `span_id` identifies the request span, not the active child span.** Use `trace_id` to jump Loki→Tempo. ✅ HAVE (documented limitation).

## 5. Secrets and PII

- **P21. Credentials are redacted at the logger, not at the call site.** Passwords, tokens (access/refresh/id), auth codes, OTPs, cookies, `client_secret`, API keys, `Authorization` headers — via pino `redact`. A logged credential is a security incident and a review blocker on auth/payment code. ✅ HAVE (Node).
- **P22. Log the shape, never the value** — `tokenLength`, `hasPassword: boolean`, `codePresent: true`. ✅ HAVE (standard).
- **P23. Personal data (email, name, phone, address, IP) is minimized in logs and never at INFO; prefer stable ids over values.** A PII-handling/retention policy (what may be logged, for how long, how it is purged from Loki) is written and enforced. ❌ GAP (secret redaction exists; a PII classification + retention policy does not).
- **P24. The redaction path list is shared, versioned, and identical across Node and Python** so a field redacted in one language is redacted in the other. ❌ GAP (Node list is per-service copy; no shared/versioned list, no Python equivalent).

## 6. Distributed tracing — backend

- **P25. `initTelemetry({ serviceName })` runs once per process, before the instrumented modules load**, via a preload or a bootstrap entrypoint (static ESM imports run first, so a late call misses spans). ✅ HAVE (Node; all 13 services + 3 backend trees).
- **P26. `tracingMiddleware()` is mounted before any logger that reads trace context, and is never mounted without `initTelemetry()`** (a no-op SDK stamps all-zero ids that look real and resolve to nothing). ✅ HAVE (Node; via `backend/core` bootstrap `preMiddleware`).
- **P27. OTLP goes to FuzeInfra's Collector via `OTEL_EXPORTER_OTLP_ENDPOINT`, never to Tempo/Loki directly; endpoint/protocol/sampling come from `OTEL_*` env.** ✅ HAVE (Helm `<service>.otel.endpoint` → env, default the in-cluster collector).
- **P28. Python services get the same trace instrumentation** (OTel SDK + ASGI/WSGI or framework middleware, OTLP to the same Collector, same span/attribute conventions). ❌ GAP (no `telemetry-py` package; see §9).

## 7. Distributed tracing — frontend

- **P29. The browser bootstrap calls `initBrowserTelemetry({ serviceName })` as early as possible**, before any `fetch`/`XHR`, so outbound calls carry `traceparent` and continue the server trace. ✅ HAVE (`frontend/src/main.tsx`).
- **P30. Cross-origin API calls declare their origin in `propagateTraceHeaderCorsUrls` and the API allows the `traceparent` request header in CORS.** Default propagation is same-origin only. ✅ HAVE as capability / 🟡 PARTIAL in practice (same-origin API base is the convention, so the default usually suffices; any cross-origin remote must set this explicitly).
- **P31. Client-side error/log payloads are tagged with the active `trace_id`** (`tagWithTraceContext`/`getActiveTraceId`) so a browser error links to its trace. ✅ HAVE (`initBrowserRum()` stamps `trace_id`/`span_id` from the active span on every error, log and vital it ships — `packages/telemetry/src/rum.ts`; wired in `frontend/src/main.tsx`. A trace id is present only when a span is active at capture time, e.g. inside an instrumented fetch).

## 8. RUM — real-user monitoring (frontend)

- **P32. The browser reports Core Web Vitals (LCP, CLS, INP, TTFB, FCP) and navigation/resource timing to the Collector/backend** for real-user performance monitoring. ✅ HAVE (`initBrowserRum()`: `web-vitals` LCP/CLS/INP/TTFB/FCP + `PerformanceObserver` navigation timing and slow/failed resource timing, beaconed to the same-origin `/api/v1/rum`; the backend emits them as `source:"rum"` structured logs. Delivery to the Collector as OTLP/metrics is the P37 follow-up).
- **P33. Uncaught JS errors and unhandled promise rejections are captured in the browser and reported to the server** (via `sendBeacon`/OTLP logs), tagged with `trace_id`, route, release, and user/session id. ✅ HAVE (`window` `error` + `unhandledrejection` listeners — `addEventListener`, so no existing handler is clobbered — redacted, de-duplicated per tab, shipped via `sendBeacon`/`fetch keepalive`. Identity is the anonymous per-tab session id; no user id is sent, by design).
- **P34. The frontend ships deliberate structured logs to the server for observability** — not just traces — through a shared browser logger with the same level semantics as the backend. ✅ HAVE (`initBrowserRum(...).logger.{error,warn,info,debug}`; ships `warn`+`error` by default, `minLogLevel` widens it. The shell does not yet call the logger from feature code — adopt it at new boundaries/decision branches).
- **P35. RUM payloads carry a stable session id and the app release/version**, so a slow session can be tied to a deploy and followed across page loads. ✅ HAVE (`session_id` persisted in `sessionStorage`, in-memory fallback; `release` from `VITE_APP_RELEASE`, falling back to the Vite mode — set `VITE_APP_RELEASE` at build time to get a true deploy id).
- **P36. RUM and client logs are rate-limited and sampled client-side**, and never include PII or secrets in attributes. ✅ HAVE (token-bucket `maxEventsPerMinute`, per-batch cap, session-level `sampleRate` for vitals/timing/info+debug — errors and warn/error logs are never session-sampled; key- and value-based redaction of JWTs, bearer tokens, e-mails, secrets, long hex blobs; URLs stripped of query/hash; re-redacted server-side).
- **P37. A backend ingest route (or Collector browser receiver) accepts the RUM/client-log stream** under the same-origin API base, authenticated/rate-limited, and forwards to the Collector. 🟡 PARTIAL (`POST /api/v1/rum` in `backend/src/routes/rum.ts`: schema-validated, per-IP rate-limited, auth intentionally optional so login-page failures are reportable, emitted as structured pino logs to stdout → Loki. NOT yet forwarded to the Collector as OTLP: that needs a Collector-side receiver/pipeline in FuzeInfra — delegated via `@fuze`).

## 9. Packaging and install

- **P38. OTel instrumentation is consumed from the one family package, never hand-rolled per repo.** Node: `@fuzefront/telemetry` (published as `@izzywdev/fuzefront-telemetry`). ✅ HAVE (Node package exists, has Node + browser entries, publishes to GitHub Packages).
- **P39. A Python telemetry package exists with matching semantics** (`fuzefront-telemetry` under `packages/telemetry-py/`, pinned to the Node package's conventions the way `identity-py` is pinned to `@izzywdev/fuzefront-identity`): `init_telemetry()`, an ASGI/WSGI tracing middleware, a `with_trace_context` log binder, and the shared structured logger. ❌ GAP (no `telemetry-py`; Python fleet services have no standard).
- **P40. The telemetry package is actually published and installable from the private registry**, and publish is green. ✅ HAVE (unblocked by the `packages-publish` fix; `@izzywdev/fuzefront-telemetry` installs in other repos).
- **P41. Node and Python telemetry packages are parity-checked in CI** (same env var names, same attribute keys, same redaction list) so a trace from one language is readable alongside the other — mirroring `gate_identifier --registry-parity`. ❌ GAP (no Python package yet, so no parity gate).

## 10. Metrics

- **P42. Each service exposes a Prometheus `/metrics` endpoint**, scraped via the `prometheus.io/*` pod annotations FuzeInfra auto-discovers. 🟡 PARTIAL (host `backend/` and `selection-list-service` have `prom-client` + `/metrics`; the other ~11 services do not).
- **P43. Every service emits the RED signals for its HTTP surface — Rate, Errors, Duration (a request-count by route+status, and a latency histogram)** — from shared middleware, not hand-rolled per route. ❌ GAP (no shared metrics middleware; the two services with `/metrics` do it ad hoc).
- **P44. Resource/dependency signals (DB pool in-use, Kafka consumer lag, external-call latency) are exported where the service owns that resource.** ❌ GAP.
- **P45. Metric names and labels follow a fixed convention and bounded-cardinality rule** (route template as a label, never raw path or user id). ❌ GAP (no metrics naming standard doc).
- **P46. Business/domain counters for critical flows (logins, token issues, payments, installs) are emitted** so a drop is alertable independent of logs. ❌ GAP.

## 11. Health, readiness, and probes

- **P47. Liveness is a shallow `/health` (process up, always 200 unless the event loop is dead); readiness is `/health/ready` that pings the real dependencies (DB, broker).** A dependency that disappears later takes the pod out of the Service without a liveness restart loop. ✅ HAVE (the pattern is in the services, e.g. `config-service`).
- **P48. Migrations fail fast at startup — a service refuses to listen if its schema is not present, rather than serving 500s with a green `/health`.** ✅ HAVE (e.g. `config-service` rethrows on migration failure).
- **P49. Probes are wired in the Helm chart to the right endpoints with sane timeouts**, and a readiness failure is observable (logged + a metric), not silent. 🟡 PARTIAL (probes exist; the "readiness failure is a metric/alert" half is not standardized).

## 12. Events, retention, sampling, cost

- **P50. Kafka produce/consume logs boundary timing and the outbox/consumer path logs dedupe + version-guard decisions** (ties observability to the data-consistency standard). 🟡 PARTIAL (boundary logging applies; consumer-decision logging is per-service, not gated).
- **P51. Trace sampling is configured for prod — not 100%.** The package defaults `sampleRatio: 1` (sample everything) with a `ParentBasedSampler`; prod needs a tail/head sample ratio set via env so the Collector and Tempo are not flooded (and cost-bounded). ❌ GAP (default is sample-all; no prod ratio set).
- **P52. Log/trace/metric retention and cardinality budgets are defined** (how long Loki/Tempo/Prometheus keep data, what the per-service series budget is) — owned with FuzeInfra. ❌ GAP (FuzeInfra-side; app-side budget undocumented).
- **P53. High-volume DEBUG is off in prod by default and bounded when on** (P6 handles the flip; this is the guard that turning it on does not OOM Loki). 🟡 PARTIAL (default-off is in force; a bounded-debug guard is not).

## 13. Alerting, SLOs, dashboards

- **P54. Each service has a baseline Grafana dashboard (RED + its own domain signals)** derived from the metrics above. 🟡 PARTIAL (FuzeInfra provides family dashboards; per-service app dashboards depend on P42–P46 which are gaps).
- **P55. Critical paths (auth, payments, data-mutation) have SLOs and alerts** (latency/error-rate burn alerts), not just dashboards. ❌ GAP.
- **P56. Alert routing is defined (who gets paged for what)** — owned with FuzeInfra. ❌ GAP (app-side alert definitions).

## 14. Enforcement and onboarding

- **P57. A CI gate verifies telemetry is actually wired** — `initTelemetry()` present and mounted before the logger, a `/metrics` endpoint present, no raw `console.*` in new service code — rather than relying on review. ❌ GAP (today it survives on review only; `gate-vacuous-check` and `ui-runtime-validation` cover adjacent things, not this).
- **P58. `sdlc-bootstrap` installs the telemetry package and mounts the middleware for a newly onboarded repo**, so a fresh repo is observable from day one (with an env-resolution default for reaching the Collector). ❌ GAP (documented in the logging skill §9; needs a rollout owner).
- **P59. The implementer Definition-of-Done includes the observability checklist** (shared logger, zero new `console.*`, boundary+error logs, `reqId`+trace binding, redaction, `/metrics`) before `SCOPE DONE`; the reviewer enforces it and REPORTS violations rather than patching them. ✅ HAVE (in the logging skill DoD; extended here to metrics/RUM as those land).
- **P60. This standard is the canonical policy; other docs point here rather than restating it**, and when a gap closes its status tag is updated in the same PR that closes it. ✅ HAVE (by this document's construction).

---

## Where we are, in one paragraph

Backend **tracing and request/boundary logging are done** across every Node service (P1–P2, P6–P8, P10–P20, P25–P27, P29–P30 on the backend side). The **real gaps**, in rough priority order, are: **forwarding the RUM stream to the Collector** (P37 — frontend RUM P31–P36 and the logged ingest route landed in `@fuzefront/telemetry` 0.2.0), a **Python telemetry package** for the fleet's Python services (P4, P28, P39, P41), **universal Prometheus metrics with RED signals** (P42–P46), a **CI enforcement gate + bootstrap install** so this cannot regress (P57–P58), and the operational layer — **prod trace sampling, PII/retention policy, SLOs/alerts** (P23–P24, P51–P56).

## Build plan (sequencing the gaps)

1. **Frontend RUM (FuzeFront, this repo).** Extend `@fuzefront/telemetry/browser` with web-vitals (P32), a global error/rejection handler that reports via `sendBeacon` tagged with `trace_id`/session/release (P33, P35), and a thin browser logger (P34); add the backend ingest route under the same-origin API base (P37); wire it in `main.tsx`. One package change + one host change + one backend route.
2. **`telemetry-py` package (FuzeFront, this repo).** New `packages/telemetry-py/` mirroring the Node package: `init_telemetry()`, ASGI + WSGI tracing middleware, `with_trace_context`, the shared JSON logger, the shared redaction list; add the Node↔Python parity gate (P4, P24, P28, P39, P41).
3. **Metrics middleware (FuzeFront, this repo).** A shared RED-signals `/metrics` middleware in `backend/core`, mounted by every service; domain counters on the critical flows (P42–P46).
4. **Enforcement + bootstrap (FuzeFront + FuzeSDLC).** `gate-observability` CI check (P57) here; the `sdlc-bootstrap` install step (P58) in FuzeSDLC, delegated via `@fuze`.
5. **Operational layer (with FuzeInfra).** Prod sample ratio (P51), PII/retention policy (P23–P24, P52), per-service dashboards + SLO/alerts (P54–P56) — the FuzeInfra-owned pieces delegated via `@fuze`.
6. **Fleet rollout.** Once `telemetry-py` publishes, each consuming repo with a Node or Python backend installs the package and mounts the middleware — delegated per repo via `@fuze`, tracked against this standard's checklist.
