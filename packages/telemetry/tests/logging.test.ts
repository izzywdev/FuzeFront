import { Writable } from 'stream';
import pino from 'pino';
import { withTraceContext } from '../src/logging';

/** A real Writable stream, synchronously capturing each parsed log line.
 * pino does NOT treat a plain `{ write(line) {...} }` object as a valid
 * destination (it silently falls back to `process.stdout` instead of calling
 * it), so tests need an actual `stream.Writable`. */
function capturingLogger() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });
  return { logger: pino(stream), lines };
}

describe('withTraceContext', () => {
  it('attaches trace_id AND span_id to every log line when both are present', () => {
    const { logger, lines } = capturingLogger();

    const req = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' };
    const traced = withTraceContext(logger, req);
    traced.info('handled request');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      span_id: '00f067aa0ba902b7',
      msg: 'handled request',
    });
  });

  it('attaches trace_id alone when span_id is absent', () => {
    const { logger, lines } = capturingLogger();

    const traced = withTraceContext(logger, { traceId: 'abc123' });
    traced.info('no span id here');

    expect(lines[0]).toMatchObject({ trace_id: 'abc123' });
    expect(lines[0]).not.toHaveProperty('span_id');
  });

  it('coexists with an existing reqId binding rather than replacing it', () => {
    const { logger, lines } = capturingLogger();
    const withReqId = logger.child({ reqId: 'family-reqid-abc123' });

    const traced = withTraceContext(withReqId, { traceId: 'trace-xyz', spanId: 'span-xyz' });
    traced.info('both ids present');

    expect(lines[0]).toMatchObject({
      reqId: 'family-reqid-abc123',
      trace_id: 'trace-xyz',
      span_id: 'span-xyz',
    });
  });

  it('returns the ORIGINAL logger unchanged for an untraced request (no traceId)', () => {
    const logger = pino();
    const traced = withTraceContext(logger, {});
    expect(traced).toBe(logger);
  });

  it('works against any pino-shaped logger, not just real pino (structural typing)', () => {
    const bindingsSeen: unknown[] = [];
    const fakeLogger = {
      child(bindings: Record<string, unknown>) {
        bindingsSeen.push(bindings);
        return this;
      },
    };

    withTraceContext(fakeLogger, { traceId: 't1', spanId: 's1' });
    expect(bindingsSeen).toEqual([{ trace_id: 't1', span_id: 's1' }]);
  });
});
