/**
 * @fuzefront/telemetry — `initTelemetry` (Node entry).
 *
 * Bootstraps the OpenTelemetry Node SDK ONCE PER PROCESS. Call this before any
 * other application code runs (first line of the service entrypoint, before
 * route/handler modules that create outbound clients are imported) — auto
 * instrumentation patches modules (`http`, `express`) at require-time, so
 * starting the SDK late misses spans for anything already required.
 *
 * Deliberately built on `@opentelemetry/sdk-node` + individually-selected
 * instrumentations (`HttpInstrumentation`, `ExpressInstrumentation`) rather
 * than the `@opentelemetry/auto-instrumentations-node` meta-package. That
 * meta-package wires ~15 instrumentations (pg, redis, mongodb, graphql, aws-
 * sdk, …) most of which no FuzeFront service uses today — pulling it in would
 * roughly triple this package's install size for instrumentation nobody
 * exercises. Add a specific instrumentation via `TelemetryOptions.
 * instrumentations` as a concrete need shows up (see `docs/TRACE_CONTRACT.md
 * #why-not-the-meta-package`).
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { resolveTelemetryConfig } from './config';
import { createTraceExporter } from './exporter';
import type { TelemetryHandle, TelemetryOptions } from './types';

export function initTelemetry(options: TelemetryOptions): TelemetryHandle {
  const config = resolveTelemetryConfig(options);
  const traceExporter = createTraceExporter(config);

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      ...(config.serviceVersion ? { [ATTR_SERVICE_VERSION]: config.serviceVersion } : {}),
      ...config.resourceAttributes,
    }),
    traceExporter,
    // A non-root span (one with a sampled parent context, e.g. continuing an
    // inbound `traceparent`) always inherits its parent's decision — only a
    // NEW trace's root span is subject to `sampleRatio`. This is what makes
    // `sampleRatio < 1` safe for later tuning: it never fragments a trace that
    // is already being recorded upstream.
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRatio) }),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      ...(options.instrumentations ?? []),
    ],
  });

  sdk.start();

  return {
    config,
    shutdown: () => sdk.shutdown(),
  };
}
