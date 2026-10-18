import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { NextFunction, Request, Response } from 'express';
import { tracingMiddleware } from '../src/middleware';

/** Minimal fake Request/Response — a real Express app isn't needed to
 * exercise the middleware's header-precedence/continuation logic. */
function fakeReq(headers: Record<string, string> = {}): Request {
  return {
    method: 'GET',
    path: '/widgets/42',
    headers,
  } as unknown as Request;
}

function fakeRes(): Response & { _finish: () => void; _close: () => void; statusCode: number } {
  let finishHandler: (() => void) | undefined;
  let closeHandler: (() => void) | undefined;
  const res = {
    statusCode: 200,
    on: (event: string, handler: () => void) => {
      if (event === 'finish') finishHandler = handler;
      if (event === 'close') closeHandler = handler;
      return res;
    },
    _finish: () => finishHandler?.(),
    _close: () => closeHandler?.(),
  };
  return res as unknown as Response & { _finish: () => void; _close: () => void; statusCode: number };
}

describe('tracingMiddleware', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let contextManager: AsyncHooksContextManager;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    // In production, `initTelemetry`'s `NodeSDK` registers a real context
    // manager (AsyncHooksContextManager) as part of `sdk.start()` — without
    // one, `@opentelemetry/api`'s default `NoopContextManager` makes
    // `context.with(ctx, fn)` call `fn()` WITHOUT actually switching the
    // active context, so `context.active()` inside `next` would silently
    // return the root context instead of the span's. Registering one here
    // mirrors what `initTelemetry` does for real.
    contextManager = new AsyncHooksContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
  });

  afterEach(async () => {
    trace.disable();
    propagation.disable();
    context.disable();
    contextManager.disable();
    await provider.shutdown();
  });

  it('starts a NEW root trace when there is no inbound traceparent header', () => {
    const middleware = tracingMiddleware();
    const req = fakeReq();
    const res = fakeRes();
    const next = jest.fn();

    middleware(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(req.spanId).toMatch(/^[0-9a-f]{16}$/);

    res._finish();
    const [span] = exporter.getFinishedSpans();
    expect(span.spanContext().traceId).toBe(req.traceId);
    expect(span.parentSpanContext).toBeUndefined();
  });

  it('CONTINUES an inbound W3C traceparent instead of starting a new trace', () => {
    const inboundTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const inboundSpanId = '00f067aa0ba902b7';
    const traceparent = `00-${inboundTraceId}-${inboundSpanId}-01`;

    const middleware = tracingMiddleware();
    const req = fakeReq({ traceparent });
    const res = fakeRes();
    const next = jest.fn();

    middleware(req, res, next as NextFunction);

    // Same trace, NEW span id (a child span, not a duplicate of the parent).
    expect(req.traceId).toBe(inboundTraceId);
    expect(req.spanId).not.toBe(inboundSpanId);

    res._finish();
    const [span] = exporter.getFinishedSpans();
    expect(span.spanContext().traceId).toBe(inboundTraceId);
    expect(span.parentSpanContext?.spanId).toBe(inboundSpanId);
  });

  it('never touches req.reqId / req.requestId / x-request-id — it owns traceparent only', () => {
    const middleware = tracingMiddleware();
    const req = fakeReq({ 'x-request-id': 'family-reqid-abc123' }) as Request & {
      reqId?: string;
      requestId?: string;
    };
    req.reqId = 'family-reqid-abc123';
    const res = fakeRes();

    middleware(req, res, jest.fn() as unknown as NextFunction);

    expect(req.reqId).toBe('family-reqid-abc123'); // untouched
    expect(req.requestId).toBeUndefined(); // never set by this middleware
    expect(req.traceId).toBeDefined(); // its own field, independently populated
  });

  it('runs `next` inside the span context so a downstream child span nests under it', () => {
    const middleware = tracingMiddleware();
    const req = fakeReq();
    const res = fakeRes();

    let childTraceId: string | undefined;
    let childParentSpanId: string | undefined;

    middleware(req, res, (() => {
      // Simulates application code (or an instrumentation) starting a child
      // span from the ACTIVE context set up by the middleware.
      const tracer = trace.getTracer('test');
      const child = tracer.startSpan('downstream-call', undefined, context.active());
      childTraceId = child.spanContext().traceId;
      childParentSpanId = req.spanId;
      child.end();
    }) as NextFunction);

    expect(childTraceId).toBe(req.traceId);
    expect(childParentSpanId).toBe(req.spanId);
  });

  it('records the response status and flags 5xx responses on the span', () => {
    const middleware = tracingMiddleware();
    const req = fakeReq();
    const res = fakeRes();
    res.statusCode = 503;

    middleware(req, res, jest.fn() as unknown as NextFunction);
    res._finish();

    const [span] = exporter.getFinishedSpans();
    expect(span.attributes['http.status_code']).toBe(503);
    expect(span.attributes['error']).toBe(true);
  });

  it('ends the span on `close` when `finish` never fires (e.g. an SSE client disconnect)', () => {
    const middleware = tracingMiddleware();
    const req = fakeReq();
    const res = fakeRes();

    middleware(req, res, jest.fn() as unknown as NextFunction);
    // The client drops the connection; Express/Node emit `close`, not
    // `finish`, for a response that was never res.end()'d.
    res._close();

    const [span] = exporter.getFinishedSpans();
    expect(span).toBeDefined();
    expect(span.spanContext().traceId).toBe(req.traceId);
  });

  it('renames the span to the matched route once Express sets req.route, collapsing per-id cardinality', () => {
    const middleware = tracingMiddleware();
    const req = fakeReq() as Request & { route?: { path?: string } };
    const res = fakeRes();

    middleware(req, res, jest.fn() as unknown as NextFunction);
    // Express sets `req.route` on the SAME request object once its router
    // matches a pattern — simulated here between middleware start and
    // response finish, exactly as it happens for real for a global
    // middleware mounted ahead of the router.
    req.route = { path: '/widgets/:id' };
    res._finish();

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('GET /widgets/:id');
  });

  it('includes the router mount prefix (req.baseUrl) in the renamed span, not just req.route.path', () => {
    const middleware = tracingMiddleware();
    const req = fakeReq() as Request & { route?: { path?: string }; baseUrl?: string };
    const res = fakeRes();

    middleware(req, res, jest.fn() as unknown as NextFunction);
    // A route matched inside a Router mounted at a prefix: req.route.path is
    // only the pattern LOCAL to that router ('/:itemId'); req.baseUrl carries
    // the mount prefix ('/v1/selection-lists/items'). Using route.path alone
    // would collapse this with every other mounted router's equally-named
    // inner route to the same span name.
    req.baseUrl = '/v1/selection-lists/items';
    req.route = { path: '/:itemId' };
    res._finish();

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('GET /v1/selection-lists/items/:itemId');
  });

  it('selects the matching entry when req.route.path is an array (Express multi-path registration)', () => {
    const middleware = tracingMiddleware();
    // Express sets route.path to the ARRAY as given when a handler is
    // registered with multiple patterns in one call (e.g. this PR's own
    // `app.get(['/ready', '/api/ready'], ...)`) — not whichever one matched.
    // A bare template-string interpolation of that array would silently
    // produce the nonsensical 'GET /ready,/api/ready' via
    // Array.prototype.toString() for EITHER request.
    const req = { ...fakeReq(), path: '/api/ready' } as Request & {
      route?: { path?: string | string[] };
    };
    const res = fakeRes();

    middleware(req, res, jest.fn() as unknown as NextFunction);
    req.route = { path: ['/ready', '/api/ready'] };
    res._finish();

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('GET /api/ready');
    expect(span.attributes['http.route']).toBe('/api/ready');
  });

  it('falls back to a joined, bounded-cardinality name when no array entry exactly matches a parameterized alternate', () => {
    const middleware = tracingMiddleware();
    // A concrete request path never exactly equals a parameterized pattern
    // like '/users/:id', so the exact-match selection can't recover which
    // alternate matched without a path-to-regexp dependency. Joining keeps
    // the result deterministic and bounded (one name per route
    // REGISTRATION, not per request) rather than reproducing the original
    // comma-joined-array bug.
    const req = { ...fakeReq(), path: '/users/42' } as Request & {
      route?: { path?: string | string[] };
    };
    const res = fakeRes();

    middleware(req, res, jest.fn() as unknown as NextFunction);
    req.route = { path: ['/users/:id', '/people/:id'] };
    res._finish();

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('GET /users/:id|/people/:id');
  });

  it('preserves the matched baseUrl+route snapshot across Express restoring req.baseUrl during error-forwarding out of a nested router', () => {
    const middleware = tracingMiddleware();
    const req = fakeReq() as Request & { route?: { path?: string }; baseUrl?: string };
    const res = fakeRes();
    res.statusCode = 500;

    middleware(req, res, jest.fn() as unknown as NextFunction);
    // The normal match: req.baseUrl carries the mount prefix while
    // req.route is set to the inner router's local-only pattern.
    req.baseUrl = '/v1/items';
    req.route = { path: '/:itemId' };
    // The handler then calls next(err) to escape the nested router.
    // Verified empirically against real Express: it restores req.baseUrl
    // to the OUTER scope's value ('') while unwinding, WITHOUT touching
    // req.route, which still points at the inner route. Recomputing from
    // the then-current values would wrongly produce 'GET /:itemId'.
    req.baseUrl = '';
    res._finish();

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('GET /v1/items/:itemId');
    expect(span.attributes['http.route']).toBe('/v1/items/:itemId');
  });

  it('collapses an unmatched request (404, or rejected before routing) to a fixed name, never the raw path', () => {
    const middleware = tracingMiddleware();
    // No req.route is ever set on this request — simulates a request that
    // never reaches a matching route: a body-parser rejection before the
    // router runs, or a genuine 404 on an arbitrary/adversarial path.
    const req = fakeReq();
    const res = fakeRes();
    res.statusCode = 404;

    middleware(req, res, jest.fn() as unknown as NextFunction);
    res._finish();

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('GET (unmatched)');
    expect(span.attributes['http.route']).toBeUndefined();
  });

  it('preserves an already-matched req.route when mounted per-router, after matching', () => {
    const middleware = tracingMiddleware();
    // Documented supported usage (TracingMiddlewareOptions.spanName):
    // mounted per-router, AFTER Express has already matched a route and
    // set req.route — not ahead of the router, the usual case every other
    // test here exercises.
    const req = fakeReq() as Request & { route?: { path?: string }; baseUrl?: string };
    req.baseUrl = '/v1/widgets';
    req.route = { path: '/:id' };
    const res = fakeRes();

    middleware(req, res, jest.fn() as unknown as NextFunction);

    // The already-matched route must survive the middleware installing its
    // accessor — both for downstream handlers reading req.route, and for
    // the span itself.
    expect(req.route).toEqual({ path: '/:id' });
    res._finish();

    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('GET /v1/widgets/:id');
    expect(span.attributes['http.route']).toBe('/v1/widgets/:id');
  });

  it('respects a caller-supplied spanName for an unmatched request instead of forcing the fixed name', () => {
    const middleware = tracingMiddleware({ spanName: () => 'custom-unmatched-name' });
    const req = fakeReq();
    const res = fakeRes();
    res.statusCode = 404;

    middleware(req, res, jest.fn() as unknown as NextFunction);
    res._finish();

    // TracingMiddlewareOptions.spanName is documented as the caller's own
    // naming contract for every request; the unmatched-request fallback
    // must only apply when nothing was supplied, not override a custom one.
    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('custom-unmatched-name');
  });

  it('does not double-end the span when BOTH `finish` and `close` fire', () => {
    const middleware = tracingMiddleware();
    const req = fakeReq();
    const res = fakeRes();

    middleware(req, res, jest.fn() as unknown as NextFunction);
    res._finish();
    res._close();

    // A second span.end() call is a no-op by the OTel spec, but asserting
    // exactly one finished span is the actual regression this guards: two
    // calls here would otherwise mean two DIFFERENT finished-span exports —
    // the double-export this guard exists to prevent — not just a harmless
    // repeat end() on the same object.
    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });
});
