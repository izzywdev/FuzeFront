/**
 * @fuzefront/telemetry — OTLP trace exporter selection (Node entry).
 *
 * Both gRPC and HTTP are supported and selectable via config because not
 * every deployment target reaches gRPC equally — some k8s NetworkPolicies /
 * egress proxies allow plain HTTP but block a raw gRPC (HTTP/2) connection.
 * See `docs/TRACE_CONTRACT.md#transport`.
 */
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter as OTLPGrpcTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPTraceExporter as OTLPHttpTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { toHttpTracesUrl } from './config';
import type { ResolvedTelemetryConfig } from './types';

export function createTraceExporter(config: ResolvedTelemetryConfig): SpanExporter {
  if (config.protocol === 'http') {
    return new OTLPHttpTraceExporter({
      url: toHttpTracesUrl(config.otlpEndpoint),
      ...(config.headers ? { headers: config.headers } : {}),
    });
  }

  // NOTE: `config.headers` (OTEL_EXPORTER_OTLP_HEADERS) is intentionally NOT
  // forwarded here. The gRPC exporter wants a `grpc.Metadata` instance, not a
  // plain object, and `@grpc/grpc-js` is only a TRANSITIVE dependency of
  // `@opentelemetry/exporter-trace-otlp-grpc` — reaching into it directly
  // would be depending on an undeclared package. FuzeInfra's collector takes
  // no exporter auth today (see docs/TRACE_CONTRACT.md#transport); a
  // deployment that later needs collector auth over gRPC should either add
  // `@grpc/grpc-js` as a direct dependency here and extend this function, or
  // (simpler) select `protocol: 'http'`, whose exporter takes plain headers.
  return new OTLPGrpcTraceExporter({ url: config.otlpEndpoint });
}
