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
 * actually writes, captured off `process.stdout.write` since `logger.ts`'s
 * singleton logger writes there by default (matching how the service really
 * runs; no test-only stream injection point to route around).
 */
import { withReqId } from '../src/lib/logger'

function captureStdoutJson(fn: () => void): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = []
  const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    const text = chunk.toString()
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      lines.push(JSON.parse(line))
    }
    return true
  })
  try {
    fn()
  } finally {
    spy.mockRestore()
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
