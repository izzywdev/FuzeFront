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

function defaultSpanName(req: Request): string {
  const routePath = (req as { route?: { path?: string } }).route?.path;
  return `${req.method} ${routePath ?? req.path}`;
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

    const requestContext = trace.setSpan(parentContext, span);

    res.on('finish', () => {
      span.setAttribute('http.status_code', res.statusCode);
      span.setAttribute('http.method', req.method);
      span.setAttribute('http.route', (req as { route?: { path?: string } }).route?.path ?? req.path);
      if (res.statusCode >= 500) {
        span.setAttribute('error', true);
      }
      span.end();
    });

    // Run the rest of the request inside the span's context so any code that
    // starts a CHILD span downstream (e.g. `HttpInstrumentation`'s outbound
    // client spans, or a manual `tracer.startSpan()` in application code)
    // nests under this one instead of starting its own trace.
    context.with(requestContext, next);
  };
}
