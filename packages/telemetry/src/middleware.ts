/**
 * @fuzefront/telemetry — `tracingMiddleware()` (Node entry, Express).
 *
 * Starts (or continues) one span per request and exposes its `trace_id`/
 * `span_id` on `req` for logging to pick up via `withTraceContext`.
 *
 * ## How this agrees with the family `reqId` convention instead of fighting it
 *
 * The logging skill's reference `requestLogger` (`.claude/skills/logging/
 * SKILL.md` §4/§8) assigns `req.reqId` from an inbound `x-request-id` header,
 * falling back to a generated UUID — and `@fuzefront/core`'s
 * `createExpressApp` assigns `req.requestId` similarly. This middleware
 * NEVER reads or writes `req.reqId` / `req.requestId`, and never looks at
 * `x-request-id` at all. It owns exactly one header — the W3C `traceparent`
 * (+ `tracestate`) — and exactly two fields — `req.traceId` / `req.spanId`.
 *
 * The two correlation schemes are complementary, not competing:
 *   - `reqId` is a FuzeFront-local id, always present, human-assigned or
 *     UUID-generated, greppable within ONE service's logs.
 *   - `trace_id`/`span_id` are OTel ids that continue ACROSS services when the
 *     `traceparent` header propagates hop to hop (which `reqId` does not do by
 *     itself, short of the manual outbound-header propagation the logging
 *     skill describes).
 *
 * Mount both middlewares; bind both fields on the child logger (see
 * `withTraceContext` and the updated §8 reference in the logging skill). If a
 * caller sends BOTH `x-request-id` and `traceparent`, both are honored as
 * given — this middleware has no opinion on `x-request-id` because it never
 * looks at it.
 */
import { context, propagation, trace, SpanKind, type Span } from '@opentelemetry/api';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** OTel trace id of this request's span, hex-encoded. Populated by
       * `tracingMiddleware()`. Absent if the middleware isn't mounted, or if
       * tracing was never initialized (`initTelemetry`) — a no-op
       * `ProxyTracer` still produces spans, but with an all-zero, invalid
       * trace id; see `isValidTraceId` in `@opentelemetry/api` if a caller
       * needs to distinguish "untraced" from "traced but unsampled". */
      traceId?: string;
      /** OTel span id of this request's span, hex-encoded. */
      spanId?: string;
    }
  }
}

export interface TracingMiddlewareOptions {
  /** Instrumentation-library name recorded on the tracer. Default
   * `'@fuzefront/telemetry'`. Override per-service if you want spans this
   * middleware creates to show a distinct instrumentation scope in Tempo. */
  tracerName?: string;
  /**
   * Span name for a request. Default `` `${req.method} ${req.route ?? req.path}` ``.
   * `req.route` (set by Express AFTER route matching) is preferred over
   * `req.path` when available, so e.g. `/users/123` and `/users/456` collapse
   * to one span name `GET /users/:id` instead of fragmenting Tempo's span
   * list per id — but `req.route` isn't set yet at the point this middleware
   * runs if mounted before the router, so `req.path` remains the practical
   * default unless this middleware is mounted per-router, after matching.
   */
  spanName?: (req: Request) => string;
}

// `req.route.path` is only the pattern matched by the ROUTER THAT MATCHED IT —
// for a router mounted with `app.use('/v1/selection-lists', itemsRouter)`,
// an inner route `/:itemId` reports route.path as just `/:itemId`, dropping
// the mount prefix entirely. `req.baseUrl` carries exactly that prefix, so
// combining them is required: using route.path alone collapsed distinct
// mounted routers' endpoints (e.g. `GET /docs/` and `GET /v1/selection-lists/`)
// down to the same span name `GET /`.
// Express allows registering several patterns in one call (e.g. this PR's
// own `app.get(['/ready', '/api/ready'], ...)`); when it does, `route.path`
// is the ARRAY as given, not whichever entry actually matched this request.
// `req.path` is local to the current router scope — the same scope as each
// array entry — so an exact match against it recovers the real match for
// the (common) case of static alternates. A parameterized alternate that
// doesn't match exactly (no path-to-regexp here, to avoid a new dependency
// for a naming nicety) still collapses to one deterministic, bounded
// (one name per route REGISTRATION, not per request) name instead of the
// nonsensical comma-joined string a bare template interpolation of the
// array would silently produce via Array.prototype.toString().
function selectRoutePath(path: string | string[], req: Request): string {
  if (typeof path === 'string') return path;
  return path.find((candidate) => candidate === req.path) ?? path.join('|');
}

function matchedRoutePath(req: Request): string | undefined {
  // Prefer the snapshot `tracingMiddleware()` captures the INSTANT Express
  // sets `req.route` (see the `Object.defineProperty` below) over
  // recomputing from the CURRENT `req.route`/`req.baseUrl`: when a handler
  // inside a mounted Router calls `next(err)`, Express restores
  // `req.baseUrl` to the OUTER router's value while unwinding — but leaves
  // `req.route` pointing at the INNER router's (now stale-paired) route.
  // Recombining them live at response-end (this function's fallback path,
  // for a request that somehow never went through the setter — e.g. this
  // middleware mounted after the router already set req.route) would then
  // pair an unwound baseUrl with a route.path from a different scope,
  // under-reporting the route for every 5xx that error-forwards out of a
  // nested router — exactly where accurate attribution matters most.
  const snapshot = (req as { __fuzefrontMatchedRoute?: string }).__fuzefrontMatchedRoute;
  if (snapshot) return snapshot;
  const routePath = (req as { route?: { path?: string | string[] } }).route?.path;
  if (!routePath) return undefined;
  const baseUrl = (req as { baseUrl?: string }).baseUrl ?? '';
  const full = `${baseUrl}${selectRoutePath(routePath, req)}`.replace(/\/{2,}/g, '/');
  return full === '' ? '/' : full;
}

function defaultSpanName(req: Request): string {
  return `${req.method} ${matchedRoutePath(req) ?? req.path}`;
}

/**
 * Express middleware: starts a SERVER span per request, continuing an inbound
 * W3C `traceparent` (via the globally-registered propagator — see
 * `initTelemetry`, which registers `NodeSDK`'s default W3C composite
 * propagator; standalone use without `initTelemetry` requires registering one
 * explicitly, e.g. `propagation.setGlobalPropagator(new
 * W3CTraceContextPropagator())`, or extraction is a no-op and every request
 * starts a new root trace).
 */
export function tracingMiddleware(options: TracingMiddlewareOptions = {}): RequestHandler {
  const tracer = trace.getTracer(options.tracerName ?? '@fuzefront/telemetry');
  const spanName = options.spanName ?? defaultSpanName;

  return function fuzefrontTracingMiddleware(req: Request, res: Response, next: NextFunction): void {
    // `propagation.extract` on a carrier with no matching header (no inbound
    // `traceparent`) returns the given context unchanged — always safe to
    // call unconditionally rather than branching on the header's presence.
    const parentContext = propagation.extract(context.active(), req.headers);

    const span: Span = tracer.startSpan(
      spanName(req),
      { kind: SpanKind.SERVER },
      parentContext
    );

    const spanContext = span.spanContext();
    req.traceId = spanContext.traceId;
    req.spanId = spanContext.spanId;

    // Intercept Express's own `req.route = route` assignment (a plain
    // property set, deep inside Router/Layer dispatch) to snapshot
    // `req.baseUrl + route.path` the INSTANT a route actually matches,
    // rather than recomputing it later from whatever `req.baseUrl` and
    // `req.route` happen to hold when the response ends — see
    // `matchedRoutePath()`'s comment for why those can disagree by then.
    // `configurable: true` so nothing downstream that re-defines this
    // property throws.
    //
    // Seed from whatever `req.route` ALREADY holds: this middleware is
    // documented as mountable per-router, after matching (see
    // TracingMiddlewareOptions.spanName above) — in that case Express set
    // req.route before this function ever ran, and installing the
    // accessor with a bare `undefined` initial value would discard that
    // already-matched route out from under every downstream handler.
    const existingRoute = (req as { route?: { path?: string | string[] } }).route;
    let matchedRoute: { path?: string | string[] } | undefined = existingRoute;
    const snapshotRoute = (value: { path?: string | string[] } | undefined) => {
      if (value?.path) {
        const baseUrl = (req as { baseUrl?: string }).baseUrl ?? '';
        const full = `${baseUrl}${selectRoutePath(value.path, req)}`.replace(/\/{2,}/g, '/');
        (req as { __fuzefrontMatchedRoute?: string }).__fuzefrontMatchedRoute = full === '' ? '/' : full;
      }
    };
    snapshotRoute(existingRoute);
    Object.defineProperty(req, 'route', {
      configurable: true,
      enumerable: true,
      get(): { path?: string | string[] } | undefined {
        return matchedRoute;
      },
      set(value: { path?: string | string[] } | undefined) {
        matchedRoute = value;
        snapshotRoute(value);
      },
    });

    const requestContext = trace.setSpan(parentContext, span);

    // Idempotent: `finish` AND `close` can both fire for the same response
    // (and `close` fires EVEN AFTER `finish` on some Node versions), so a
    // bare boolean guard — not two independent `span.end()` calls — is what
    // keeps this from double-ending the span.
    let ended = false;
    const endSpan = () => {
      if (ended) return;
      ended = true;
      // `req.route` is only populated by Express AFTER its router matches a
      // path pattern — which hasn't happened yet when this middleware starts
      // the span (mounted ahead of the router). By the time the response
      // finishes, matching has happened, so re-derive the name here and
      // rename the span: without this, every parameterized route (e.g.
      // `/:listId/items/:itemId`) keeps the raw, UUID-bearing `req.path` as
      // its permanent span name, fragmenting Tempo's operation list and
      // trace-index cardinality per id instead of collapsing to one name.
      const routePath = matchedRoutePath(req);
      if (routePath) {
        // Express sets `req.route`/`req.baseUrl` in place on the same request
        // object, so re-invoking `spanName` now (vs. at span-start time)
        // picks them up.
        span.updateName(spanName(req));
        span.setAttribute('http.route', routePath);
      } else if (spanName === defaultSpanName) {
        // No route ever matched — rejected before the router ran (e.g. a
        // body-parser failure on malformed JSON) or a genuine 404. req.path
        // is attacker-controlled and unbounded (adversarial/scanning
        // requests), so falling back to it here would reintroduce, for every
        // UNMATCHED request, the exact per-path cardinality problem
        // matchedRoutePath() exists to collapse for MATCHED ones. Use a
        // fixed name instead, and omit http.route entirely rather than
        // echoing the raw path into it. Only for the DEFAULT naming
        // function, though — a caller-supplied `options.spanName` owns
        // this decision for every request per the documented contract, so
        // its own low-cardinality scheme (if any) for the unmatched case
        // must not be overridden here.
        span.updateName(`${req.method} (unmatched)`);
      } else {
        span.updateName(spanName(req));
      }
      span.setAttribute('http.status_code', res.statusCode);
      span.setAttribute('http.method', req.method);
      if (res.statusCode >= 500) {
        span.setAttribute('error', true);
      }
      span.end();
    };
    res.on('finish', endSpan);
    // `finish` fires only when the response is fully sent. A long-lived
    // connection that the CLIENT drops first (an SSE `/stream` route; any
    // route whose handler never calls `res.end()`) never emits `finish` —
    // only `close`. Without this, that span is never ended/exported, and
    // the request silently disappears from the trace.
    res.on('close', endSpan);

    // Run the rest of the request inside the span's context so any code that
    // starts a CHILD span downstream (e.g. `HttpInstrumentation`'s outbound
    // client spans, or a manual `tracer.startSpan()` in application code)
    // nests under this one instead of starting its own trace.
    context.with(requestContext, next);
  };
}
