/**
 * @fuzefront/telemetry — `withTraceContext` (Node entry).
 *
 * The logging-integration helper: binds `trace_id`/`span_id` onto a pino (or
 * pino-shaped) child logger alongside the existing `reqId` binding, so every
 * log line for a traced request automatically carries its trace id with zero
 * extra work at call sites — fulfilling FuzeInfra's three-pillar contract
 * (every log line during a traced request carries that request's `trace_id`
 * so Loki<->Tempo correlation works both directions).
 *
 * Usage (see the updated §8 reference in `.claude/skills/logging/SKILL.md`):
 *
 * ```ts
 * app.use(tracingMiddleware());               // sets req.traceId/spanId
 * app.use((req, res, next) => {
 *   const reqId = (req.headers['x-request-id'] as string) ?? randomUUID();
 *   req.log = withTraceContext(logger.child({ reqId }), req);
 *   next();
 * });
 * ```
 */
import type { ChildCapableLogger, TraceBearingRequest } from './types';

/**
 * Returns a child of `logger` with `trace_id` (+ `span_id`, when present)
 * bound, for correlation with Tempo/Loki. If `req.traceId` is absent (tracing
 * not initialized, or `tracingMiddleware()` not mounted on this route), the
 * ORIGINAL logger is returned unchanged — an untraced request must still log
 * normally rather than throwing or silently losing its other bindings
 * (`reqId`, `userId`, etc).
 */
export function withTraceContext<L extends ChildCapableLogger<L>>(
  logger: L,
  req: TraceBearingRequest
): L {
  if (!req.traceId) return logger;

  return logger.child({
    trace_id: req.traceId,
    ...(req.spanId ? { span_id: req.spanId } : {}),
  });
}
