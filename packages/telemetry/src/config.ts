/**
 * @fuzefront/telemetry — env-driven config resolution (Node entry).
 *
 * Mirrors the `process.env.X || 'default'` convention used by
 * `backend/security/src/config/permit.ts` / `database.ts` rather than
 * inventing a new one: read the standard OTel env var first, fall back to a
 * package default, never throw on a missing optional value.
 */
import type { OtlpProtocol, ResolvedTelemetryConfig, TelemetryOptions } from './types';

/** Local-dev default (docker-compose service name FuzeInfra documents) per
 * transport. Production/k8s sets `OTEL_EXPORTER_OTLP_ENDPOINT` explicitly via
 * Helm — this is deliberately NOT the in-cluster `fuzeinfra-otel-collector.
 * fuzeinfra` DNS name; see `TelemetryOptions.otlpEndpoint`'s doc comment. */
const DEFAULT_OTLP_ENDPOINT: Record<OtlpProtocol, string> = {
  grpc: 'http://otel-collector:4317',
  http: 'http://otel-collector:4318',
};

/** Normalizes the standard `OTEL_EXPORTER_OTLP_PROTOCOL` values
 * (`grpc` | `http/protobuf` | `http/json`) to this package's `OtlpProtocol`.
 * Unrecognized/unset input yields `undefined` so the caller's own default applies. */
export function normalizeProtocol(value: string | undefined): OtlpProtocol | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'grpc') return 'grpc';
  if (v === 'http/protobuf' || v === 'http/json' || v === 'http') return 'http';
  return undefined;
}

/** Parses the standard `k1=v1,k2=v2` form of `OTEL_EXPORTER_OTLP_HEADERS`. */
export function parseOtlpHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of value.split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (key) headers[key] = decodeURIComponent(val);
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/** Parses `OTEL_TRACES_SAMPLER_ARG` (a bare float, per the OTel spec, when
 * `OTEL_TRACES_SAMPLER=traceidratio`/`parentbased_traceidratio`) as a 0..1
 * ratio. Out-of-range or unparseable input is ignored (falls through to the
 * caller's default) rather than producing a nonsensical sampler. */
export function parseSampleRatio(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return undefined;
  return n;
}

/**
 * Resolves the effective config for `initTelemetry`. Exported (not just used
 * internally) so tests can assert the precedence/defaulting behavior without
 * spinning up a real `NodeSDK`.
 */
export function resolveTelemetryConfig(
  options: TelemetryOptions,
  env: NodeJS.ProcessEnv = process.env
): ResolvedTelemetryConfig {
  if (!options.serviceName) {
    throw new Error('initTelemetry: `serviceName` is required');
  }

  const protocol: OtlpProtocol =
    options.protocol ?? normalizeProtocol(env.OTEL_EXPORTER_OTLP_PROTOCOL) ?? 'grpc';

  const otlpEndpoint =
    options.otlpEndpoint || env.OTEL_EXPORTER_OTLP_ENDPOINT || DEFAULT_OTLP_ENDPOINT[protocol];

  const sampleRatio =
    options.sampleRatio ?? parseSampleRatio(env.OTEL_TRACES_SAMPLER_ARG) ?? 1;

  const headers = options.headers ?? parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS);

  return {
    serviceName: options.serviceName,
    serviceVersion: options.serviceVersion,
    otlpEndpoint,
    protocol,
    sampleRatio,
    resourceAttributes: options.resourceAttributes ?? {},
    ...(headers ? { headers } : {}),
  };
}

/** Appends `/v1/traces` to an OTLP/HTTP endpoint that doesn't already carry a
 * signal-specific path — the HTTP exporter does NOT do this itself (see
 * `@opentelemetry/otlp-exporter-base`'s `OTLPExporterConfigBase.url` doc: it
 * defaults to `http://localhost:4318/v1/traces`, but a caller-supplied `url`
 * is used verbatim). gRPC endpoints are passed through unchanged — gRPC has
 * no per-signal path. */
export function toHttpTracesUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
}
