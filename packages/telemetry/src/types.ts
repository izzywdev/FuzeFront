/**
 * @fuzefront/telemetry — shared types (Node entry).
 *
 * See `docs/TRACE_CONTRACT.md` for the full contract this package implements
 * against FuzeInfra's `docs/consuming-repos/OBSERVABILITY_DASHBOARDS.md`.
 */
import type { Instrumentation } from '@opentelemetry/instrumentation';

/** The two OTLP transports FuzeInfra's collector accepts. Browsers only ever
 * use `'http'` — they cannot speak gRPC — but Node services may need either,
 * depending on whether the deployment target's egress reaches gRPC (4317)
 * cleanly or only plain HTTP (4318). See `docs/TRACE_CONTRACT.md#transport`. */
export type OtlpProtocol = 'grpc' | 'http';

export interface TelemetryOptions {
  /** Required. Becomes the `service.name` resource attribute every span (and,
   * via `withTraceContext`, every correlated log line) carries. */
  serviceName: string;
  /** Optional `service.version` resource attribute (e.g. `process.env.npm_package_version`). */
  serviceVersion?: string;
  /**
   * OTLP collector endpoint. **Never** point this at Tempo/Loki directly —
   * FuzeInfra's contract is collector-only (see `docs/TRACE_CONTRACT.md`).
   *
   * Default resolution order (matches the `process.env.X || 'default'`
   * convention used across `backend/security/src/config/*`):
   *   1. this option,
   *   2. the standard `OTEL_EXPORTER_OTLP_ENDPOINT` env var,
   *   3. a protocol-appropriate local-dev default (`http://otel-collector:4317`
   *      for gRPC, `http://otel-collector:4318` for HTTP) — the docker-compose
   *      service name FuzeInfra documents for local dev. Production/k8s
   *      deployments set `OTEL_EXPORTER_OTLP_ENDPOINT` explicitly via Helm to
   *      `http://fuzeinfra-otel-collector.fuzeinfra:4317`, the same way
   *      `PERMIT_PDP_URL` etc. are wired — this package does not hardcode a
   *      cluster-internal DNS name as a fallback.
   */
  otlpEndpoint?: string;
  /**
   * OTLP transport. Default resolution: this option, then the standard
   * `OTEL_EXPORTER_OTLP_PROTOCOL` env var (`grpc` | `http/protobuf` | `http/json`,
   * normalized to `'grpc' | 'http'`), then `'grpc'`.
   */
  protocol?: OtlpProtocol;
  /**
   * Fraction (0..1) of root traces to sample. Default `1` (sample everything)
   * while the collector pipeline is being validated fleet-wide — see the
   * initiative context in `docs/TRACE_CONTRACT.md#sampling`. A non-root span
   * always honors its parent's sampling decision (`ParentBasedSampler`), so
   * this only governs where a NEW trace starts.
   *
   * Resolution: this option, then the standard `OTEL_TRACES_SAMPLER_ARG` env
   * var, then `1`.
   */
  sampleRatio?: number;
  /** Extra resource attributes merged onto every span (e.g. `{ 'deployment.environment': 'prod' }`). */
  resourceAttributes?: Record<string, string>;
  /**
   * Extra OTLP exporter headers (e.g. collector auth). Resolution: this
   * option, then the standard `OTEL_EXPORTER_OTLP_HEADERS` env var
   * (`k1=v1,k2=v2` form), then none.
   */
  headers?: Record<string, string>;
  /**
   * Extra instrumentations beyond the defaults (`HttpInstrumentation` +
   * `ExpressInstrumentation`). We instrument these two specifically rather
   * than pulling `@opentelemetry/auto-instrumentations-node` (the meta
   * package that wires ~15 instrumentations, most unused by any FuzeFront
   * service today) to keep the dependency footprint sane — see
   * `docs/TRACE_CONTRACT.md#why-not-the-meta-package`. Add more here as
   * concrete needs arise (e.g. `PgInstrumentation`, `IORedisInstrumentation`).
   */
  instrumentations?: Instrumentation[];
}

export interface ResolvedTelemetryConfig {
  serviceName: string;
  serviceVersion?: string;
  otlpEndpoint: string;
  protocol: OtlpProtocol;
  sampleRatio: number;
  resourceAttributes: Record<string, string>;
  headers?: Record<string, string>;
}

export interface TelemetryHandle {
  /** Resolved config actually used to build the exporter — useful for tests/diagnostics. */
  readonly config: ResolvedTelemetryConfig;
  /** Flush + stop the SDK. Call on graceful shutdown, alongside the service's
   * other `close*()` calls (DB pool, Kafka relay, etc). */
  shutdown(): Promise<void>;
}

/**
 * Minimal structural subset of a pino `Logger` that `withTraceContext` needs.
 * Typed structurally (not `import('pino').Logger`) so this package never
 * takes a hard dependency on pino — any logger with a `.child()` that merges
 * bindings (pino, and pino-compatible shims) satisfies this.
 */
export interface ChildCapableLogger<Self = unknown> {
  child(bindings: Record<string, unknown>): Self;
}

/** The fields `withTraceContext` binds onto the child logger. Field names
 * (`trace_id`/`span_id`, snake_case) match the OTel log-correlation
 * convention FuzeInfra's Loki<->Tempo derived-field wiring expects — see
 * `docs/TRACE_CONTRACT.md#log-correlation-fields`. Deliberately NOT
 * camelCase like `reqId`: this is an OTel wire convention, not a FuzeFront
 * one, and the two coexist on the same child logger rather than one renaming
 * the other. */
export interface TraceLogFields {
  trace_id: string;
  span_id?: string;
}

/** Anything carrying the fields `tracingMiddleware` attaches to `req`. Typed
 * structurally so `withTraceContext` works against Express's `Request` (via
 * the ambient `traceId?`/`spanId?` augmentation in `middleware.ts`) without
 * importing `express` types itself. */
export interface TraceBearingRequest {
  traceId?: string;
  spanId?: string;
}
