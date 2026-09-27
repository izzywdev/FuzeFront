---
name: logging
description: Use when writing or reviewing ANY service/backend/frontend code that runs a request path, calls an external system, or makes a decision that could fail in prod — the family structured-logging standard. Covers pino JSON logging, the ERROR/WARN/INFO/DEBUG level semantics + env-flippable LOG_LEVEL, boundary logging (every external call logs start/end/elapsed ms), per-request correlation IDs (reqId child logger), distributed-trace correlation (trace_id/span_id via @fuzefront/telemetry, OTel traces to FuzeInfra's Collector), MANDATORY secret redaction, critical-path-first incremental migration off raw console.*, and the implementer + reviewer definition-of-done. Owned by backend-engineer/frontend-engineer (implement) + the reviewer (enforce).
---

# logging / observability-logging

Structured, leveled, correlated logging on every critical path. **Silent code is undebuggable in prod** — this skill is the family standard for making sure it never ships that way.

## Why this is a hard rule (the incident that wrote it)

A production login **hung**, and it cost hours to diagnose because FuzeFront's security service had **no structured logging** — 210 raw `console.*` calls and the auth-critical files (the OIDC authorize/callback hairpin) were **completely silent**. There was nothing to grep, no timing, no correlation. Once per-step timing logs were added at the boundaries, the root cause — a **6.5s authorize hairpin** — was found in **30 seconds**.

The lesson, encoded here as policy: **leveled + structured + correlated logging on critical paths is not optional.** A path with no logs is a path you cannot debug in prod; when it breaks (and auth/payment paths break at the worst time), you are blind. Instrument first, especially at boundaries and decision branches.

## 1. Structured JSON via pino — one shared logger per service

- **Family standard: [`pino`](https://getpino.io)** for Node/TypeScript services. Structured **JSON** to stdout — the platform's log stack (Loki) ingests JSON; free-text `console.log` is not queryable.
- **One shared logger util per service** (`src/lib/logger.ts` or equivalent). Never `new` a logger ad hoc per file, and never `console.*` in service code. Everything derives from the one root logger (child loggers, below).
- **Never `console.log`/`console.error` in new service code.** `console.*` is unleveled (can't be filtered), unstructured (can't be queried), and unredacted (leaks secrets). The gate for new code is zero raw `console.*`.

## 2. Levels + `LOG_LEVEL` — flip verbosity WITHOUT a redeploy

Verbosity is controlled by the **`LOG_LEVEL` env var**, read at startup. **Prod default: `info`.** To debug a live incident you set `LOG_LEVEL=debug` and restart the pod (or use a runtime level endpoint) — **no code change, no rebuild, no redeploy**. This is the whole point: the debug detail is already *written into the code*, dormant at `info`, and you turn it on when you need it.

| Level | Semantics | Examples |
|-------|-----------|----------|
| **ERROR** | An operation failed; needs attention. Always logged **with context** (see §3). | unhandled exception, external call failed after retries, invariant violated, auth misconfig |
| **WARN** | Degraded / recoverable / suspicious, but handled. | retry succeeded on 2nd attempt, fell back to cache, deprecated path hit, slow dependency over threshold |
| **INFO** | **Flow milestones** — the request-level story a human follows. Prod-safe volume. | request received, auth succeeded for user X, order created, external call *initiated* (summary), request completed |
| **DEBUG** | **Per-hop detail** — every boundary crossing incl. **elapsed ms**, decision-branch inputs/outcomes, intermediate state. Off in prod by default. | `authorize() start`, `authorize() end elapsed=6512ms`, "chose branch B because hasPassword=null", DB query issued/returned rows=N |

Rule of thumb: **INFO tells the story, DEBUG tells the timing and the why.** If you'd want it during a 2am incident but not in steady-state prod noise, it's DEBUG.

## 3. Boundary logging — the rule that finds the 6.5s hairpin

**Every external call logs start + end + elapsed ms.** External = any hop out of the process: HTTP/fetch to another service or provider (Authentik, Permit, Stripe, Unleash), a DB query, a cache/Redis op, a Kafka produce/consume, a filesystem/network call. This is what turned "the login hangs somewhere" into "authorize() took 6512ms" in 30s.

```
DEBUG  authentik.authorize start   { reqId, op: "authorize" }
DEBUG  authentik.authorize end     { reqId, op: "authorize", elapsedMs: 6512, status: 200 }
```

- **Every caught error logs WITH context** — never `catch {}` (a swallowed error is a silent failure) and never `catch(e){ throw e }` with nothing logged. Log the error object, the operation, and the identifying context (`reqId`, `userId`/`orgId`, the resource id, the upstream status). An error with no context is nearly as useless as no error.
- **Critical-path decision branches are observable.** Where the code chooses a path on auth/payment/data flows, log the input that drove it and which branch was taken — including the **fail-closed** cases (reveal-once token already revealed; remove-last-2FA-factor → 409; demote-the-last-admin; `hasPassword: null` → "set a password first"). If prod took the wrong branch, the log must let you see *why*.

## 4. Correlation IDs — one request, one greppable thread

Every request gets a **`reqId`** (accept an inbound `x-request-id` / `traceparent` if present, else generate a UUID) bound as a **child-logger** field at the entry middleware, and that child logger is used for the rest of the request:

```ts
const reqId = req.headers['x-request-id'] ?? randomUUID();
req.log = logger.child({ reqId });
```

- **One request = one greppable thread.** `grep reqId=abc123` returns the entire lifecycle across every hop in order. This is the difference between reading a story and staring at interleaved noise.
- **Carry the correlation id across hops** — propagate `reqId` as an outbound header (`x-request-id`) on every external call so the downstream service's logs join the same thread. Bind stable request-scoped context too (`userId`, `orgId`/tenant, route) once on the child so you don't repeat it on every line.
- **`reqId` correlates one service's own logs. It does not, by itself, link a log line to a distributed trace.** For that — following a request across services in Tempo, or jumping from a Loki log line to the exact span that produced it — see §9 (`trace_id`/`span_id` via `@fuzefront/telemetry`). The two ids are complementary, bound on the SAME child logger, never one replacing the other.

## 5. Secret redaction — MANDATORY, non-negotiable

**Never log a credential.** Passwords, tokens (access/refresh/ID), auth codes, OTPs, cookies, `client_secret`, API keys, and `Authorization` headers are **redacted at the logger** via pino's `redact` option — you do not rely on remembering to omit them at each call site. A logged credential is a **security incident** (it lands in Loki, backups, screenshots) and, on auth/payment code, is a review **blocker**.

```ts
redact: {
  paths: [
    'req.headers.authorization', 'req.headers.cookie',
    '*.password', '*.token', '*.access_token', '*.refresh_token', '*.id_token',
    '*.code', '*.otp', '*.client_secret', '*.apiKey', '*.secret',
    'password', 'token', 'authorization', 'cookie', 'set-cookie',
  ],
  censor: '[REDACTED]',
}
```

Hard rule for auth/payment code: **if in doubt, redact.** Log the *shape* (`tokenLength`, `hasPassword: boolean`, `codePresent: true`), never the value.

## 6. Critical-path-first + incremental migration

You do **not** need a big-bang rewrite to adopt this. Order the work by blast radius:

1. **Instrument the critical paths first** — auth, payments, and data-mutation flows. These are where prod blindness hurts most (the incident was auth). Add boundary logs + reqId + redaction here before anything else.
2. **Migrate legacy `console.*` incrementally** — replace raw `console.*` with the shared leveled logger opportunistically as you touch files; a standing cleanup ticket tracks the long tail (e.g. the 210 calls). It does not block feature work, but it does get done.
3. **No raw `console.*` in NEW code — ever.** New code is held to the full standard from line one; that's the ratchet that stops the debt from growing while the legacy tail shrinks.

**Frontend note:** the same principles apply in the browser — a shared leveled logger (pino works in the browser, or a thin wrapper), no stray `console.log` in shipped code, redact before logging user data, and correlate client errors with a request id where one exists. Browser console-cleanliness at runtime is separately gated by `ui-runtime-validation`; this skill is about *deliberate* app logging, not leftover debug noise.

## 7. Definition of done — implementer + reviewer

**Owners:** `backend-engineer` and `frontend-engineer` **implement** this on the code they write; the **reviewer** (`appsec-reviewer` on endpoint/auth PRs, or the orchestrator's review pass) **enforces** it — a critical path that ships silent, or a credential that reaches a log, is a **REPORTED finding / blocker**, not something the reviewer patches.

**Implementer checklist (before `SCOPE DONE`):**
- [ ] Uses the one shared pino logger; **zero raw `console.*`** in the code I added.
- [ ] `LOG_LEVEL` read from env; prod paths sane at `info`, rich detail at `debug` (no redeploy needed to get it).
- [ ] Every external call I added logs **start + end + elapsed ms**; every `catch` logs the error **with context**; critical decision branches (incl. fail-closed cases) are observable.
- [ ] Requests carry a **`reqId`** child-logger binding, propagated to downstream calls.
- [ ] Where `@fuzefront/telemetry` is wired for this service (rollout is per-service, not fleet-wide yet — see §9): `trace_id`/`span_id` are bound alongside `reqId` via `withTraceContext`.
- [ ] pino **`redact`** covers passwords/tokens/codes/cookies/`client_secret`/`authorization`; I logged no credential values (shape only).
- [ ] Critical paths (auth/payment/data) instrumented first; any legacy `console.*` I couldn't migrate is captured in a cleanup ticket.

**Reviewer checklist (enforce, don't fix):**
- [ ] No new critical path ships **silent** (no boundary/decision logs) — REPORT if so.
- [ ] No credential can reach a log (redact paths cover the call sites) — **blocker** on auth/payment code.
- [ ] Levels used correctly (errors at ERROR with context; not everything at INFO; debug detail actually at DEBUG).
- [ ] `reqId` correlation present and propagated.

## 8. Reference — copy-paste TS

```ts
// src/lib/logger.ts — the ONE shared logger per service
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',   // prod default info; flip to debug via env, no redeploy
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
      '*.password', '*.token', '*.access_token', '*.refresh_token', '*.id_token',
      '*.code', '*.otp', '*.client_secret', '*.apiKey', '*.secret',
      'password', 'token', 'authorization', 'cookie',
    ],
    censor: '[REDACTED]',
  },
  base: { service: process.env.SERVICE_NAME ?? 'unknown' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// request middleware — bind a per-request child logger with a correlation id
import { randomUUID } from 'crypto';
// §9: tracingMiddleware() sets req.traceId/req.spanId from an inbound
// traceparent (or starts a new trace) — it never touches x-request-id or
// req.reqId, so mounting it alongside this middleware is additive, not a
// header-precedence fight. See @fuzefront/telemetry's docs/TRACE_CONTRACT.md.
import { tracingMiddleware, withTraceContext } from '@fuzefront/telemetry';
app.use(tracingMiddleware());

export function requestLogger(req, res, next) {
  const reqId = (req.headers['x-request-id'] as string) ?? randomUUID();
  req.reqId = reqId;
  // withTraceContext binds trace_id (+ span_id) alongside reqId when the
  // request was traced; for an untraced request it returns the reqId-only
  // child logger unchanged — never throws, never drops the reqId binding.
  req.log = withTraceContext(logger.child({ reqId, route: req.path, method: req.method }), req);
  req.log.info('request received');
  res.on('finish', () =>
    req.log.info({ status: res.statusCode }, 'request completed'));
  next();
}

// boundary helper — every external call logs start + end + elapsed ms
export async function timed<T>(log: pino.Logger, op: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  log.debug({ op }, `${op} start`);
  try {
    const out = await fn();
    log.debug({ op, elapsedMs: Math.round(performance.now() - start) }, `${op} end`);
    return out;
  } catch (err) {
    // caught error ALWAYS logs with context
    log.error({ op, elapsedMs: Math.round(performance.now() - start), err }, `${op} failed`);
    throw err;
  }
}

// usage on a critical path — this is what would have found the 6.5s hairpin in 30s
// propagate reqId downstream so the next service's logs join the same thread
const tokens = await timed(req.log, 'authentik.authorize', () =>
  fetch(authorizeUrl, { headers: { 'x-request-id': req.reqId } }));
// decision branch, observable + fail-closed reason logged (no secret value)
if (user.hasPassword === null) {
  req.log.info({ userId: user.id }, 'blocked: user must set a password first');
  return res.status(409).json({ error: 'set a password first' });
}
```

## 9. Distributed trace correlation — `trace_id`/`span_id` via `@fuzefront/telemetry`

`reqId` (§4) correlates one service's own logs. It does **not**, by itself, let you jump from a Loki log line to the Tempo trace that produced it, or follow a request as it crosses service boundaries — that needs a real distributed trace, and FuzeInfra now runs one (Grafana Tempo + an OTel Collector). **`@fuzefront/telemetry`** is the family package that sends it: OpenTelemetry tracing for both Node services and the browser, built specifically to extend this skill rather than compete with it.

**The three-pillar contract this closes:** every log line emitted during a traced request must carry that request's OTel `trace_id` (and ideally `span_id`), so Loki lines link to their Tempo trace and back. `trace_id`/`span_id` are **snake_case** — the OTel log-correlation convention — deliberately distinct from the family's own camelCase `reqId`; the two fields coexist on the same child logger rather than one renaming the other:

```json
{"level":30,"time":1735000000000,"reqId":"a1b2c3d4","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","msg":"request completed"}
```

```ts
import { tracingMiddleware, withTraceContext } from '@fuzefront/telemetry';

app.use(tracingMiddleware());                 // sets req.traceId / req.spanId

app.use((req, res, next) => {
  const reqId = (req.headers['x-request-id'] as string) ?? randomUUID();
  req.log = withTraceContext(logger.child({ reqId }), req);   // now every line carries trace_id too
  next();
});
```

**Why this doesn't fight the `reqId` convention above.** `tracingMiddleware()` owns exactly one header (`traceparent`, W3C format) and exactly two fields (`req.traceId`/`req.spanId`) — it never reads or writes `req.reqId`, `req.requestId`, or `x-request-id`. If a caller sends both `x-request-id` and `traceparent`, both are honored independently; there is no precedence question because neither middleware inspects the other's header. Mount both middlewares (order doesn't matter between them) and bind both fields on the child logger, as in §8's reference implementation.

**Backend (Node/Express):** `initTelemetry({ serviceName })` once per process (bootstraps the OTel SDK, OTLP export to FuzeInfra's Collector — never Tempo/Loki directly), then `tracingMiddleware()` + `withTraceContext()` as above. **Browser:** `initBrowserTelemetry({ serviceName })` in the app's bootstrap entry point (e.g. `frontend/src/main.tsx`) — it also stamps outgoing `fetch`/`XHR` calls with `traceparent` so the backend's `tracingMiddleware()` continues the SAME trace, and `tagWithTraceContext()`/`getActiveTraceId()` let you tag a client-side error log with the active trace id, mirroring `withTraceContext` for the browser.

Full contract (transport, env resolution, sampling, and reference implementation for `backend/security` — the concrete service this was first wired into): `packages/telemetry/README.md` and `packages/telemetry/docs/TRACE_CONTRACT.md`.

## Related
- `ui-runtime-validation` — browser **console-cleanliness** at runtime (leftover errors/noise), complementary to deliberate app logging.
- `endpoint-authorization` — auth/authz on endpoints; boundary logging + redaction are strongest exactly on these paths.
- `verification-protocol` — the honest scoped-done discipline this skill's DoD plugs into.
- Baseline §7.2 (Observability — structured logging) is the L0 statement of this policy.
- `@fuzefront/telemetry` (§9) — distributed tracing correlated with this skill's `reqId`/pino standard; FuzeInfra's `docs/consuming-repos/OBSERVABILITY_DASHBOARDS.md` is the upstream app-side contract it implements.
