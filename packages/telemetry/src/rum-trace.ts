/**
 * Active-span helpers, split out of `browser.ts` so `rum.ts` can tag events
 * with the active trace without a circular import (`browser.ts` re-exports
 * both). Browser-safe: `@opentelemetry/api` only.
 */
import { context, trace } from '@opentelemetry/api';

/** The `trace_id` of the currently-active span, if any (e.g. inside a
 * `fetch`/`XHR` instrumentation's created span, or a span the app started
 * manually). `undefined` when nothing is active — most of the time, since
 * spans here are per-network-call, not per-page-view. */
export function getActiveTraceId(): string | undefined {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId;
}

/** The `span_id` of the currently-active span, if any. */
export function getActiveSpanId(): string | undefined {
  const span = trace.getSpan(context.active());
  return span?.spanContext().spanId;
}
