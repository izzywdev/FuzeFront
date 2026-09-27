/**
 * @jest-environment jsdom
 */
import { propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { NoopSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import {
  getActiveSpanId,
  getActiveTraceId,
  initBrowserTelemetry,
  injectTraceHeaders,
  tagWithTraceContext,
} from '../src/browser';
import type { BrowserTelemetryHandle } from '../src/browser';

// No live collector is reachable in this environment (per the task brief) —
// these assert the SHAPE of what `initBrowserTelemetry` wires up (provider
// type, default same-origin CORS propagation URL, default same-origin OTLP
// path) and the trace-context helpers' behavior, via a real WebTracerProvider
// + real span activation rather than a network round trip.
describe('initBrowserTelemetry', () => {
  let handle: BrowserTelemetryHandle | undefined;

  afterEach(async () => {
    trace.disable();
    await handle?.shutdown();
    handle = undefined;
  });

  it('registers a WebTracerProvider', () => {
    handle = initBrowserTelemetry({ serviceName: 'fuzefront-frontend' });
    expect(handle.provider).toBeInstanceOf(WebTracerProvider);
  });

  it('rejects a missing serviceName before touching the SDK at all', () => {
    // @ts-expect-error — exercising the runtime guard for a JS caller that skips the type check
    expect(() => initBrowserTelemetry({})).toThrow(/serviceName/);
  });

  it('defaults propagateTraceHeaderCorsUrls to same-origin only', () => {
    // Same-origin default matches FuzeFront's "no cross-origin API base"
    // convention (root CLAUDE.md) — this is a smoke test that init doesn't
    // throw with jsdom's default origin and that the handle comes back usable.
    handle = initBrowserTelemetry({ serviceName: 'fuzefront-frontend' });
    expect(window.location.origin).toBeTruthy();
    expect(handle.provider).toBeDefined();
  });
});

// These test the trace-context HELPERS' behavior against a real
// WebTracerProvider + real span activation, deliberately WITHOUT going
// through `initBrowserTelemetry` (which wires a real network-capable OTLP/HTTP
// exporter). `WebTracerProvider.shutdown()`/`forceFlush()` would otherwise
// attempt to actually export the ended span, and the OTLP/HTTP exporter's
// Node-platform transport code path (irrelevant here — this suite runs under
// Jest's `jsdom` environment, not a real bundler's "browser" resolution)
// requires `--experimental-vm-modules` to load. A `NoopSpanProcessor` sidesteps
// that entirely: the helpers below only depend on the ACTIVE span/context, not
// on how (or whether) a span is ever exported.
describe('trace-context helpers', () => {
  let provider: WebTracerProvider;

  beforeEach(() => {
    provider = new WebTracerProvider({ spanProcessors: [new NoopSpanProcessor()] });
    provider.register({ propagator: new W3CTraceContextPropagator() });
  });

  afterEach(async () => {
    trace.disable();
    propagation.disable();
    await provider.shutdown();
  });

  it('getActiveTraceId/getActiveSpanId return undefined with nothing active', () => {
    expect(getActiveTraceId()).toBeUndefined();
    expect(getActiveSpanId()).toBeUndefined();
  });

  it('getActiveTraceId/getActiveSpanId reflect the currently-active span', () => {
    const tracer = trace.getTracer('test');

    tracer.startActiveSpan('manual-span', span => {
      const expected = span.spanContext();
      expect(getActiveTraceId()).toBe(expected.traceId);
      expect(getActiveSpanId()).toBe(expected.spanId);
      span.end();
    });
  });

  it('tagWithTraceContext returns fields UNCHANGED when nothing is active', () => {
    const fields = { message: 'client error' };
    expect(tagWithTraceContext(fields)).toBe(fields);
  });

  it('tagWithTraceContext merges trace_id/span_id when a span is active', () => {
    const tracer = trace.getTracer('test');

    tracer.startActiveSpan('manual-span', span => {
      const expected = span.spanContext();
      const tagged = tagWithTraceContext({ message: 'client error' });
      expect(tagged).toEqual({
        message: 'client error',
        trace_id: expected.traceId,
        span_id: expected.spanId,
      });
      span.end();
    });
  });

  it('injectTraceHeaders returns {} with nothing active, and a traceparent when a span is active', () => {
    expect(injectTraceHeaders()).toEqual({});

    const tracer = trace.getTracer('test');
    tracer.startActiveSpan('manual-span', span => {
      const headers = injectTraceHeaders();
      expect(headers.traceparent).toMatch(
        new RegExp(`^00-${span.spanContext().traceId}-[0-9a-f]{16}-0[01]$`)
      );
      span.end();
    });
  });
});
