// logger.test.ts — the family structured-logging contract for this service:
// request-scoped reqId child logger, mandatory secret redaction, LOG_LEVEL,
// and boundary logging with x-request-id propagation to the Security API.

import express, { Request, Response } from 'express';
import request from 'supertest';
import {
  createLogger,
  createRequestLogger,
  createLoggedFetch,
  getLog,
  timed,
} from '../src/lib/logger';

type Line = Record<string, any>;

/** An in-memory pino destination; every line is parsed JSON. */
function capture(level = 'debug') {
  const lines: Line[] = [];
  const stream = {
    write(chunk: string) {
      for (const l of chunk.split('\n').filter(Boolean)) lines.push(JSON.parse(l));
    },
  };
  return { lines, log: createLogger(level, stream) };
}

function makeApp(root: ReturnType<typeof createLogger>) {
  const app = express();
  app.use(createRequestLogger(root));
  app.get('/ping', (req: Request, res: Response) => {
    // Handler logs through the request-scoped logger, including a value that
    // is a credential — redaction must catch it at the logger, not the call site.
    getLog(req).info(
      { req: { headers: { authorization: req.headers.authorization, cookie: 'sid=abc' } }, token: 'tok-123' },
      'handler ran',
    );
    res.status(200).json({ ok: true });
  });
  app.get('/boom', (_req: Request, res: Response) => {
    res.status(500).json({ code: 'INTERNAL_ERROR' });
  });
  return app;
}

describe('request-scoped logger', () => {
  it('binds reqId (generated) onto every line of the request and echoes it', async () => {
    const { lines, log } = capture();
    const res = await request(makeApp(log)).get('/ping');

    expect(res.status).toBe(200);
    const reqId = res.headers['x-request-id'];
    expect(reqId).toMatch(/^[0-9a-f-]{36}$/);

    const mine = lines.filter((l) => l.reqId === reqId);
    // received (debug) + handler + completed — one greppable thread.
    expect(mine.map((l) => l.msg)).toEqual(['request received', 'handler ran', 'request completed']);
    expect(mine.every((l) => l.service === 'selection-list-service')).toBe(true);
    const done = mine[2];
    expect(done).toMatchObject({ level: 'info', status: 200, method: 'GET', route: '/ping' });
    expect(typeof done.elapsedMs).toBe('number');
  });

  it('honours a well-formed inbound x-request-id and rejects a malformed one', async () => {
    const { lines, log } = capture();
    const app = makeApp(log);

    const ok = await request(app).get('/ping').set('x-request-id', 'trace-abc_123');
    expect(ok.headers['x-request-id']).toBe('trace-abc_123');
    expect(lines.some((l) => l.reqId === 'trace-abc_123')).toBe(true);

    const bad = await request(app).get('/ping').set('x-request-id', 'a b"{injected}');
    expect(bad.headers['x-request-id']).not.toBe('a b"{injected}');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('REDACTS the Authorization header, cookies and tokens — never a credential in a log line', async () => {
    const { lines, log } = capture();
    await request(makeApp(log))
      .get('/ping')
      .set('Authorization', 'Bearer super-secret-jwt');

    const raw = JSON.stringify(lines);
    expect(raw).not.toContain('super-secret-jwt');
    expect(raw).not.toContain('tok-123');
    expect(raw).not.toContain('sid=abc');
    const handler = lines.find((l) => l.msg === 'handler ran')!;
    expect(handler.req.headers.authorization).toBe('[REDACTED]');
    expect(handler.req.headers.cookie).toBe('[REDACTED]');
    expect(handler.token).toBe('[REDACTED]');
  });

  it('strips the query string from the logged route (it can carry tokens)', async () => {
    const { lines, log } = capture();
    await request(makeApp(log)).get('/ping?access_token=leak-me');
    expect(JSON.stringify(lines)).not.toContain('leak-me');
  });

  it('logs a 5xx completion at error level', async () => {
    const { lines, log } = capture();
    await request(makeApp(log)).get('/boom');
    const done = lines.find((l) => l.msg === 'request completed')!;
    expect(done).toMatchObject({ level: 'error', status: 500 });
  });
});

describe('LOG_LEVEL', () => {
  it('suppresses debug at info and emits it at debug', () => {
    const info = capture('info');
    info.log.debug('hidden');
    info.log.info('shown');
    expect(info.lines.map((l) => l.msg)).toEqual(['shown']);

    const debug = capture('debug');
    debug.log.debug('now visible');
    expect(debug.lines.map((l) => l.msg)).toEqual(['now visible']);
  });
});

describe('boundary logging', () => {
  it('timed() logs start + end with elapsedMs, and error-with-context on failure', async () => {
    const { lines, log } = capture();
    await expect(timed(log, 'db.thing', async () => 42, { orgId: 'o1' })).resolves.toBe(42);
    expect(lines.map((l) => l.msg)).toEqual(['db.thing start', 'db.thing end']);
    expect(lines[1]).toMatchObject({ op: 'db.thing', orgId: 'o1' });
    expect(typeof lines[1].elapsedMs).toBe('number');

    const failing = capture();
    await expect(
      timed(failing.log, 'db.thing', async () => {
        throw new Error('db down');
      }),
    ).rejects.toThrow('db down');
    expect(failing.lines[1]).toMatchObject({ level: 'error', op: 'db.thing', msg: 'db.thing failed' });
    expect(failing.lines[1].err.message).toBe('db down');
  });

  it('Security API fetch propagates x-request-id and logs elapsedMs without the bearer token', async () => {
    const { lines, log } = capture();
    const seen: Record<string, string>[] = [];
    const base = jest.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers);
      return { ok: true, status: 200, json: async () => ({ allow: true }) };
    });
    const fetchFn = createLoggedFetch(base as any)!;

    const app = express();
    app.use(createRequestLogger(log));
    app.get('/x', async (_req: Request, res: Response) => {
      await fetchFn('http://security:3002/api/v1/security/authz/check', {
        method: 'POST',
        headers: { authorization: 'Bearer bearer-secret', 'content-type': 'application/json' },
        body: '{}',
      });
      res.sendStatus(204);
    });

    const res = await request(app).get('/x').set('x-request-id', 'req-42');
    expect(res.status).toBe(204);
    // Propagated downstream so Security's logs join the same thread.
    expect(seen[0]['x-request-id']).toBe('req-42');
    // The caller's own headers still go through untouched.
    expect(seen[0].authorization).toBe('Bearer bearer-secret');

    const end = lines.find((l) => l.msg === 'securityapi.request end')!;
    expect(end).toMatchObject({ reqId: 'req-42', op: 'securityapi.request', status: 200, path: '/api/v1/security/authz/check' });
    expect(typeof end.elapsedMs).toBe('number');
    expect(JSON.stringify(lines)).not.toContain('bearer-secret');
  });

  it('Security API fetch failure logs at error and re-throws (authz client then denies)', async () => {
    const { lines, log } = capture();
    const base = jest.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const fetchFn = createLoggedFetch(base as any)!;

    const app = express();
    app.use(createRequestLogger(log));
    app.get('/x', async (_req: Request, res: Response) => {
      try {
        await fetchFn('http://security:3002/x', { method: 'POST', headers: {}, body: '{}' });
        res.sendStatus(200);
      } catch {
        res.sendStatus(403);
      }
    });
    const res = await request(app).get('/x');
    expect(res.status).toBe(403);
    expect(lines.find((l) => l.msg === 'securityapi.request failed')).toMatchObject({ level: 'error' });
  });
});
