/**
 * Verifies `withReqId()`'s trace-context integration (izzywdev/FuzeFront OTel
 * tracing initiative, phase 2): when a request carries `traceId`/`spanId` —
 * set by `@fuzefront/telemetry`'s `tracingMiddleware()`, mounted in
 * `src/index.ts` — the child logger it returns includes `trace_id`/`span_id`
 * on every log line, alongside the existing `reqId`. This is the concrete
 * proof of log<->trace correlation for this service: a Loki query for
 * `trace_id="..."` should return the same lines a `reqId="..."` query does,
 * plus every OTHER service's lines on the same trace.
 *
 * No live collector or Tempo needed — this only asserts the JSON shape pino
 * actually writes, captured from pino's destination stream (see captureStdoutJson); `logger.ts`'s
 * singleton logger writes there by default (matching how the service really
 * runs; no test-only stream injection point to route around).
 */
import pino from 'pino'
import { logger, withReqId } from '../src/lib/logger'

function captureStdoutJson(fn: () => void): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = []
  // Swap the singleton logger's pino destination for the duration of `fn`.
  // pino's default destination is a SonicBoom on fd 1 — asynchronous, and not
  // routed through `process.stdout.write` unless something has tampered with
  // stdout before the logger was constructed — so spying on stdout only
  // happens to work in some runners (in-band) and silently captures nothing in
  // others (jest workers). Replacing the stream via pino's own `streamSym`
  // captures exactly the line pino serialises, synchronously, everywhere.
  const stream = (logger as any)[pino.symbols.streamSym]
  ;(logger as any)[pino.symbols.streamSym] = {
    write(chunk: string) {
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue
        lines.push(JSON.parse(line))
      }
    },
  }
  try {
    fn()
  } finally {
    ;(logger as any)[pino.symbols.streamSym] = stream
  }
  return lines
}

describe('withReqId trace-context integration', () => {
  it('binds trace_id AND span_id when the request was traced', () => {
    const req = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' }

    const lines = captureStdoutJson(() => {
      withReqId('req-abc123', req).info('handled request')
    })

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      reqId: 'req-abc123',
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      span_id: '00f067aa0ba902b7',
      service: 'security-service',
      msg: 'handled request',
    })
  })

  it('omits trace_id/span_id for an untraced request (no req passed) without breaking reqId', () => {
    const lines = captureStdoutJson(() => {
      withReqId('req-abc123').info('background job, no HTTP request in scope')
    })

    expect(lines[0]).toMatchObject({ reqId: 'req-abc123' })
    expect(lines[0]).not.toHaveProperty('trace_id')
    expect(lines[0]).not.toHaveProperty('span_id')
  })

  it('falls back to "unknown" reqId (unchanged pre-existing behavior) when none is given', () => {
    const lines = captureStdoutJson(() => {
      withReqId().info('no reqId available')
    })

    expect(lines[0]).toMatchObject({ reqId: 'unknown' })
  })
})
