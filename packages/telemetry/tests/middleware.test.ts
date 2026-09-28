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

function fakeRes(): Response & { _finish: () => void; statusCode: number } {
  let finishHandler: (() => void) | undefined;
  const res = {
    statusCode: 200,
    on: (event: string, handler: () => void) => {
      if (event === 'finish') finishHandler = handler;
      return res;
    },
    _finish: () => finishHandler?.(),
  };
  return res as unknown as Response & { _finish: () => void; statusCode: number };
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
});
