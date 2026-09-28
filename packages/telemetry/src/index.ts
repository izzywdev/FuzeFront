/**
 * @fuzefront/telemetry — public barrel (Node entry).
 *
 * OpenTelemetry distributed tracing for FuzeFront-family Node services,
 * correlated with the family's pino structured-logging standard
 * (`.claude/skills/logging/SKILL.md`). See `README.md` and
 * `docs/TRACE_CONTRACT.md` for the full usage + wire contract.
 *
 * Browser usage is a SEPARATE entry point (`@fuzefront/telemetry/browser`) —
 * importing from here in a browser bundle would pull in Node-only OTel
 * packages (the gRPC exporter, `sdk-node`) that do not run in a browser.
 */
export { initTelemetry } from './init';
export { tracingMiddleware } from './middleware';
export type { TracingMiddlewareOptions } from './middleware';
export { withTraceContext } from './logging';
export {
  resolveTelemetryConfig,
  normalizeProtocol,
  parseOtlpHeaders,
  parseSampleRatio,
  toHttpTracesUrl,
} from './config';
export { createTraceExporter } from './exporter';
export type {
  ChildCapableLogger,
  OtlpProtocol,
  ResolvedTelemetryConfig,
  TelemetryHandle,
  TelemetryOptions,
  TraceBearingRequest,
  TraceLogFields,
} from './types';
