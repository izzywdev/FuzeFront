# @fuzefront/telemetry

OpenTelemetry **distributed tracing** for the FuzeFront family, correlated
with the family's [pino structured-logging standard](../../.claude/skills/logging/SKILL.md).
Sends OTLP traces to FuzeInfra's Grafana Tempo / OTel Collector — see FuzeInfra's
**`docs/consuming-repos/OBSERVABILITY_DASHBOARDS.md`** for the app-side contract
this package implements (sibling repo; not available from here — the contract
is restated as needed in [`docs/TRACE_CONTRACT.md`](./docs/TRACE_CONTRACT.md)).

> **Status: v0.1.0 — phases 1–3 of the tracing initiative.** The Node SDK, the
> browser SDK, and pino log-correlation are all implemented and unit-tested.
> No live collector round trip has been run from this repo (none is reachable
> from this dev/CI environment) — see
> [`docs/TRACE_CONTRACT.md#testing-without-a-live-collector`](./docs/TRACE_CONTRACT.md#testing-without-a-live-collector).

## Why

FuzeInfra's Collector went live and was receiving **zero** trace data —
nothing in the product fleet sent OTLP. This package is the first sender,
built so any FuzeFront service or frontend can start emitting correlated
traces with a few lines of wiring, rather than every consumer hand-rolling its
own OTel SDK setup (and inevitably drifting on exporter config, sampling, or —
worse — the header precedence between `reqId` and `traceparent`).

## Install

```bash
npm install @izzywdev/fuzefront-telemetry
```

> **Published name.** Like `@fuzefront/auth`, `@fuzefront/telemetry` is the
> *workspace-internal* name; the `@fuzefront` scope doesn't exist on GitHub
> Packages. The published package is `@izzywdev/fuzefront-telemetry`. Alias it
> to keep the short specifier: `"@fuzefront/telemetry": "npm:@izzywdev/fuzefront-telemetry@^0.1.0"`.

Two entry points:

```ts
import { initTelemetry, tracingMiddleware, withTraceContext } from '@fuzefront/telemetry';        // Node
import { initBrowserTelemetry, tagWithTraceContext } from '@fuzefront/telemetry/browser';          // Browser
```

`express` is an **optional peer dependency** of the Node entry — non-Express
consumers (a worker, a CLI) can call `initTelemetry` without pulling Express
in; only `tracingMiddleware()` needs it.

## Node usage

```ts
import express from 'express';
import { randomUUID } from 'crypto';
import { initTelemetry, tracingMiddleware, withTraceContext } from '@fuzefront/telemetry';
import { logger } from './lib/logger'; // the ONE shared pino logger, per the logging skill

// Bootstrap ONCE, as early as possible — before any module that creates
// outbound HTTP clients is required, so instrumentation patches them in time.
initTelemetry({
  serviceName: 'fuzefront-security',
  serviceVersion: process.env.npm_package_version,
  // protocol/otlpEndpoint default from OTEL_EXPORTER_OTLP_* env vars — see
  // docs/TRACE_CONTRACT.md#env-var-resolution. Override explicitly if needed:
  // protocol: 'http', otlpEndpoint: 'http://otel-collector:4318',
});

const app = express();

app.use(tracingMiddleware());               // sets req.traceId / req.spanId

app.use((req, res, next) => {
  // The family's reqId convention, unchanged (see the logging skill §4) —
  // tracingMiddleware() never touches x-request-id/reqId.
  const reqId = (req.headers['x-request-id'] as string) ?? randomUUID();
  req.log = withTraceContext(logger.child({ reqId }), req); // now every line carries trace_id too
  next();
});

app.get('/widgets/:id', (req, res) => {
  req.log.info({ id: req.params.id }, 'fetched widget'); // includes reqId AND trace_id/span_id
  res.json({ id: req.params.id });
});
```

Every log line on this request now carries **both** ids:

```json
{"level":30,"time":1735000000000,"reqId":"a1b2c3d4","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","msg":"fetched widget"}
```

Graceful shutdown — flush pending spans alongside the service's other
`close*()` calls:

```ts
const telemetry = initTelemetry({ serviceName: 'fuzefront-security' });
process.on('SIGTERM', async () => {
  await telemetry.shutdown();
  // ...db pool, Kafka relay, etc.
});
```

## Browser usage

```ts
// frontend/src/main.tsx — as early as possible, before any fetch/XHR call
// the app wants correlated with its backend.
import { initBrowserTelemetry } from '@fuzefront/telemetry/browser';

initBrowserTelemetry({
  serviceName: 'fuzefront-frontend',
  serviceVersion: import.meta.env.VITE_APP_VERSION,
  // Default otlpEndpoint '/v1/traces' assumes a same-origin ingress
  // passthrough to the Collector — see docs/TRACE_CONTRACT.md#browser-transport.
});
```

Outgoing `fetch`/`XHR` calls to the app's own backend automatically get a
`traceparent` header attached (same-origin by default —
`propagateTraceHeaderCorsUrls` extends this to other first-party origins), so
`tracingMiddleware()` on the receiving service **continues the same trace**
instead of starting a new one.

Tag a client-side error log with the active trace id:

```ts
import { tagWithTraceContext } from '@fuzefront/telemetry/browser';

window.addEventListener('error', event => {
  console.error(tagWithTraceContext({
    message: event.message,
    stack: event.error?.stack,
  }));
});
```

## Public interface

```ts
// Node
import {
  initTelemetry,                          // bootstrap the SDK once per process
  tracingMiddleware,                      // Express: per-request span + req.traceId/spanId
  withTraceContext,                       // bind trace_id/span_id onto a pino child logger
  resolveTelemetryConfig,                 // pure config resolution (env + option precedence) — mainly for tests/diagnostics
  type TelemetryOptions, type TelemetryHandle,
} from '@fuzefront/telemetry';

// Browser
import {
  initBrowserTelemetry,                   // bootstrap the Web SDK once per page load
  getActiveTraceId, getActiveSpanId,      // read the currently-active span's ids
  tagWithTraceContext,                    // tag a log/error payload with them
  injectTraceHeaders,                     // manual traceparent injection for calls fetch/XHR instrumentation doesn't cover
  type BrowserTelemetryOptions, type BrowserTelemetryHandle,
} from '@fuzefront/telemetry/browser';
```

Full usage + the wire contract (transport, env resolution, sampling,
log-correlation field names, and — importantly — **how `tracingMiddleware()`
agrees with the family `reqId` convention instead of fighting it**):
[`docs/TRACE_CONTRACT.md`](./docs/TRACE_CONTRACT.md).

## Guarantees worth knowing

- **Never points at Tempo/Loki directly.** OTLP always goes to FuzeInfra's
  Collector — see `docs/TRACE_CONTRACT.md#transport`.
- **`tracingMiddleware()` owns exactly one header (`traceparent`) and two
  fields (`req.traceId`/`req.spanId`).** It never reads/writes `req.reqId`,
  `req.requestId`, or `x-request-id` — no precedence fight with the logging
  skill's `requestLogger`.
- **A continued trace is never fragmented by `sampleRatio`.** Sampling is
  `ParentBasedSampler`-wrapped: only a NEW (root) trace is subject to the
  ratio; a span continuing an inbound `traceparent` always inherits its
  parent's decision.
- **`withTraceContext` never throws or drops other bindings.** An untraced
  request (no `req.traceId`) gets the original logger back unchanged — `reqId`
  and any other bindings are unaffected.
- **Individually-selected instrumentations, not the auto-instrumentations
  meta-package.** Keeps the dependency footprint proportional to what
  FuzeFront services actually use — see
  `docs/TRACE_CONTRACT.md#why-not-the-meta-package`.
- **Browsers never use gRPC.** The browser entry is OTLP/HTTP only, by
  necessity (no raw TCP/HTTP2 socket access from a browser).

## Install (private registry)

Published privately to **GitHub Packages** under **`@izzywdev`**
(`access: restricted`), as `@izzywdev/fuzefront-telemetry` — same rename
mechanism `.github/workflows/packages-publish.yml` applies to every
`@fuzefront/*` workspace package, no per-package config needed.

```
@izzywdev:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```sh
npm install @izzywdev/fuzefront-telemetry
```

## Contract lifecycle

Same model as `@fuzefront/auth`: this package's public exports are the
contract other services build against. A later change to `TelemetryOptions`,
`tracingMiddleware`'s field names, or `withTraceContext`'s behavior re-enters
through review, bumps `version` + `CHANGELOG.md`, and ripples deliberately —
see `CHANGELOG.md`.
