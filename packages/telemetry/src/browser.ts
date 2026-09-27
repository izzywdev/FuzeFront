/**
 * @fuzefront/telemetry/browser — browser entry.
 *
 * The browser-side counterpart to the Node entry: initializes an OTel Web SDK
 * that (a) creates a span per page load / user-visible unit of work is left
 * to the caller — this package instruments `fetch`/`XHR` calls, which is
 * where FuzeFront frontends' backend correlation actually happens — and (b)
 * propagates a W3C `traceparent` header on outgoing `fetch`/`XHR` calls to
 * FuzeFront backends, so `tracingMiddleware()` on the receiving service
 * continues the SAME trace instead of starting a new one.
 *
 * Browsers cannot speak OTLP/gRPC (no raw TCP/HTTP2 socket access), so this
 * entry uses `@opentelemetry/exporter-trace-otlp-http` exclusively — see
 * `docs/TRACE_CONTRACT.md#transport`.
 *
 * This is a SEPARATE bundle from the Node entry (`@fuzefront/telemetry`,
 * `dist/browser.{js,mjs}` via tsup's multi-entry build) so a browser build
 * never pulls in `@opentelemetry/sdk-node` / the gRPC exporter / any other
 * Node-only OTel package.
 */
import { context, propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  WebTracerProvider,
} from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/** Same-origin default, per FuzeFront's "no cross-origin API base" convention
 * (see the root `CLAUDE.md`: the frontend talks to its API same-origin so it
 * works identically under local TLS and prod ingress). This assumes the
 * host's ingress/nginx proxies `/v1/traces` through to the OTel Collector's
 * HTTP receiver — a browser should never call FuzeInfra's collector
 * cross-origin directly. Pass an explicit `otlpEndpoint` if that passthrough
 * isn't wired yet; see `docs/TRACE_CONTRACT.md#browser-transport`. */
const DEFAULT_BROWSER_OTLP_ENDPOINT = '/v1/traces';

export interface BrowserTelemetryOptions {
  /** Required. Becomes the `service.name` resource attribute on every span
   * (e.g. `'fuzefront-frontend'`). */
  serviceName: string;
  /** Optional `service.version` resource attribute (e.g. an app build/commit id). */
  serviceVersion?: string;
  /** OTLP/HTTP collector endpoint. Default: `'/v1/traces'` (same-origin — see
   * above). MUST be a plain HTTP(S) URL; browsers cannot use gRPC. */
  otlpEndpoint?: string;
  /** Fraction (0..1) of root traces to sample. Default `1`. */
  sampleRatio?: number;
  /** Extra resource attributes merged onto every span. */
  resourceAttributes?: Record<string, string>;
  /**
   * Which backend origins get the `traceparent`/`tracestate` headers attached
   * to outgoing `fetch`/`XHR` calls (CORS-restricted by the browser — a
   * `traceparent` header is only safe to send to origins that will not choke
   * on an unexpected header). Default: same-origin only (`[window.location.
   * origin]`) — the safe default for FuzeFront's own same-origin API
   * convention. Pass explicit origins/RegExps to extend correlation to other
   * first-party FuzeFront services reached cross-origin.
   */
  propagateTraceHeaderCorsUrls?: Array<string | RegExp>;
}

export interface BrowserTelemetryHandle {
  readonly provider: WebTracerProvider;
  /** Flush + stop the SDK — call e.g. on `visibilitychange`/`pagehide` if the
   * app needs to guarantee a final flush beyond `BatchSpanProcessor`'s
   * built-in `disableAutoFlushOnDocumentHide: false` default. */
  shutdown(): Promise<void>;
}

/** Initializes browser tracing ONCE per page load. Call this as early as
 * possible in the app's bootstrap (before any `fetch`/`XHR` call the app
 * wants correlated), e.g. at the top of `frontend/src/main.tsx`. */
export function initBrowserTelemetry(options: BrowserTelemetryOptions): BrowserTelemetryHandle {
  if (!options.serviceName) {
    throw new Error('initBrowserTelemetry: `serviceName` is required');
  }

  const otlpEndpoint = options.otlpEndpoint || DEFAULT_BROWSER_OTLP_ENDPOINT;
  const sampleRatio = options.sampleRatio ?? 1;
  const propagateTraceHeaderCorsUrls =
    options.propagateTraceHeaderCorsUrls ??
    (typeof window !== 'undefined' ? [window.location.origin] : []);

  const exporter = new OTLPTraceExporter({ url: otlpEndpoint });

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      ...(options.serviceVersion ? { [ATTR_SERVICE_VERSION]: options.serviceVersion } : {}),
      ...options.resourceAttributes,
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRatio) }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  // Registers the W3C trace-context propagator globally so `fetch`/`XHR`
  // instrumentation below (and any manual `propagation.inject()` call) can
  // stamp `traceparent` on outgoing requests. Context manager is left at its
  // default (`StackContextManager`) — a `ZoneContextManager` (needs the
  // `zone.js` peer) is a follow-up for apps whose async control flow crosses
  // event-loop ticks in ways `StackContextManager` can't track; see
  // `docs/TRACE_CONTRACT.md#browser-context-manager`.
  provider.register({ propagator: new W3CTraceContextPropagator() });

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({ propagateTraceHeaderCorsUrls }),
      new XMLHttpRequestInstrumentation({ propagateTraceHeaderCorsUrls }),
    ],
  });

  return {
    provider,
    shutdown: () => provider.shutdown(),
  };
}

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

/**
 * Tags a client-side error/log payload with the active `trace_id` (+
 * `span_id`, when present), mirroring the Node entry's `withTraceContext` for
 * whatever the app uses to ship browser error logs (Sentry breadcrumb extra,
 * a `fetch` call to a `/client-logs` endpoint, etc). Returns `fields`
 * unchanged when nothing is active, exactly like `withTraceContext` returning
 * the original logger unchanged for an untraced request.
 */
export function tagWithTraceContext<T extends Record<string, unknown>>(
  fields: T
): T & { trace_id?: string; span_id?: string } {
  const traceId = getActiveTraceId();
  if (!traceId) return fields;
  const spanId = getActiveSpanId();
  return { ...fields, trace_id: traceId, ...(spanId ? { span_id: spanId } : {}) };
}

/**
 * Injects the active trace context as a plain headers object, for a manual
 * outbound call this package's `fetch`/`XHR` instrumentation doesn't cover
 * (e.g. `navigator.sendBeacon`, a WebSocket handshake, a non-fetch HTTP
 * client). Returns `{}` when nothing is active.
 */
export function injectTraceHeaders(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}
