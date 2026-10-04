// failure-containment.test.ts — review H-4: one bad request must not crash (or
// hang) the process.
//
// REPRODUCTION. In Express 4 a rejected async handler is never forwarded to
// next(); the request hangs and, on Node >= 15, the unhandled rejection kills
// the process. The suite below makes EVERY database access reject — the same
// effect as Postgres answering SQLSTATE 22021 for a NUL byte — against the real
// app, and asserts each route in the review's list answers a contract 500 body
// promptly instead. Against the pre-fix routers (plain `Router()`, no terminal
// handler) these requests never complete: each carries a 3s client timeout so
// the failure is a clean red, not a 60s hang.
//
// It also covers the rest of the containment story: the terminal error handler,
// the process-level policy (unhandledRejection logged + kept alive,
// uncaughtException -> graceful shutdown), and edge validation (NUL bytes and
// malformed ids are 400 VALIDATION_ERROR before any DB call).

import { EventEmitter } from 'events';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// A DB whose every access rejects — what a Postgres error looks like to a handler.
jest.mock('../src/db', () => {
  const boom = () => Promise.reject(new Error('invalid byte sequence for encoding "UTF8": 0x00'));
  const builder: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (_res: unknown, rej: (e: unknown) => void) => boom().then(undefined, rej);
      if (prop === 'catch') return (rej: (e: unknown) => void) => boom().catch(rej);
      return () => builder; // where/select/join/... stay chainable
    },
    apply() {
      return builder;
    },
  });
  const db: any = (..._a: unknown[]) => builder;
  db.raw = jest.fn(boom);
  db.transaction = jest.fn(boom);
  db.fn = { now: () => new Date().toISOString() };
  return { db };
});

import { createApp } from '../src/app';
import { setFlagClient } from '../src/flags';
import { db } from '../src/db';
import { createRouter, asyncHandler, errorHandler, installProcessHandlers } from '../src/lib/http';
import { logger } from '../src/lib/logger';
import { containsNul, isListId, isItemId, isUserId } from '../src/middleware/validateInput';
import { ENTITY_PREFIXES } from '@izzywdev/fuzefront-identity';

const JWT_SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-failure-containment';
const token = jwt.sign({ userId: 'usr_01test', orgId: 'org_01test' }, JWT_SECRET);
const auth = { Authorization: `Bearer ${token}` };

const LIST = 'front_sl_01testlist';
const ITEM = 'front_sli_01testitem';

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
});
beforeEach(() => {
  // Release flag ON so requests reach the handlers (authz stays pass-through:
  // non-production, env var unset).
  setFlagClient({ getBooleanValue: async () => true });
});
afterEach(() => setFlagClient(null));

// Every route the review lists as having an await outside try/catch, plus the
// rest of the surface for good measure. Each must answer a 500 contract body.
const ROUTES: Array<[string, 'get' | 'post' | 'put' | 'patch' | 'delete', string, object?]> = [
  ['resolve', 'post', '/v1/resolve', { ids: [ITEM] }],
  ['translations: list', 'get', `/v1/selection-lists/${LIST}/translations`],
  ['translations: put list', 'put', `/v1/selection-lists/${LIST}/translations/fr`, { name: 'x' }],
  ['translations: delete list', 'delete', `/v1/selection-lists/${LIST}/translations/fr`],
  ['translations: item list', 'get', `/v1/selection-lists/${LIST}/items/${ITEM}/translations`],
  ['translations: put item', 'put', `/v1/selection-lists/${LIST}/items/${ITEM}/translations/fr`, { label: 'x' }],
  ['translations: delete item', 'delete', `/v1/selection-lists/${LIST}/items/${ITEM}/translations/fr`],
  ['translations: autofill', 'post', `/v1/selection-lists/${LIST}/translations/fr/autofill`, {}],
  ['lists: get one', 'get', `/v1/selection-lists/${LIST}`],
  ['lists: purge', 'delete', `/v1/selection-lists/${LIST}?purge=true`],
  ['lists: archive', 'post', `/v1/selection-lists/${LIST}/archive`],
  ['items: list', 'get', `/v1/selection-lists/${LIST}/items`],
  ['items: create', 'post', `/v1/selection-lists/${LIST}/items`, { code: 'US', label: 'United States' }],
  ['items: reorder', 'put', `/v1/selection-lists/${LIST}/items/reorder`, { item_ids: [ITEM] }],
  ['items: patch', 'patch', `/v1/selection-lists/${LIST}/items/${ITEM}`, { label: 'United States' }],
  ['items: purge', 'delete', `/v1/selection-lists/${LIST}/items/${ITEM}?purge=true`],
  ['items: archive', 'post', `/v1/selection-lists/${LIST}/items/${ITEM}/archive`],
];

describe('H-4 reproduction: a DB error in any route is a contract 500, never a hang or a crash', () => {
  // Every row is padded to 4 cells: jest-each hands `done` to a missing 4th arg.
  it.each(ROUTES.map((r) => [r[0], r[1], r[2], r[3] ?? null] as const))('%s', async (_name, method, path, body) => {
    const app = createApp();
    let req = (request(app) as any)[method](path).set(auth).timeout({ response: 3000, deadline: 4000 });
    if (body) req = req.send(body);
    const res = await req;
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: expect.any(String) });
    // Never leaks the driver message or a stack.
    expect(JSON.stringify(res.body)).not.toMatch(/0x00|invalid byte|at .*\(.*:\d+/);
  });
});

describe('createRouter / asyncHandler', () => {
  it('forwards a rejected async handler to the error handler (no hang)', async () => {
    const router = createRouter();
    router.get('/boom', async () => {
      throw new Error('db exploded');
    });
    const app = express();
    app.use(router);
    app.use(errorHandler);
    const res = await request(app).get('/boom').timeout({ response: 2000, deadline: 3000 });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
  });

  it('forwards a synchronous throw too', async () => {
    const router = createRouter();
    router.get('/sync', () => {
      throw new Error('sync boom');
    });
    const app = express();
    app.use(router);
    app.use(errorHandler);
    const res = await request(app).get('/sync');
    expect(res.status).toBe(500);
  });

  it('wraps route-level MIDDLEWARE as well as the final handler', async () => {
    const router = createRouter();
    const failingMiddleware = async () => {
      throw new Error('middleware boom');
    };
    router.get('/mw', failingMiddleware, (_req, res) => res.json({ ok: true }));
    const app = express();
    app.use(router);
    app.use(errorHandler);
    const res = await request(app).get('/mw').timeout({ response: 2000, deadline: 3000 });
    expect(res.status).toBe(500);
  });

  it('leaves a healthy handler alone', async () => {
    const router = createRouter();
    router.get('/ok', async (_req, res) => {
      res.json({ ok: true });
    });
    const app = express();
    app.use(router);
    app.use(errorHandler);
    expect((await request(app).get('/ok')).body).toEqual({ ok: true });
  });

  it('asyncHandler leaves 4-arity error middleware untouched', () => {
    const errMw = (_e: unknown, _req: unknown, _res: unknown, _next: unknown) => undefined;
    expect(asyncHandler(errMw)).toBe(errMw);
  });
});

describe('errorHandler', () => {
  const makeApp = (thrower: express.RequestHandler) => {
    const app = express();
    app.use(express.json());
    app.post('/x', thrower);
    app.use(errorHandler);
    return app;
  };

  it('answers the contract body for an unexpected error and logs it at ERROR with context', async () => {
    const spy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    // getLog() falls back to the root logger outside a request context.
    const res = await request(makeApp((_req, _res, next) => next(new Error('kaboom')))).post('/x').send({});
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
    expect(spy).toHaveBeenCalled(); // never swallowed silently
    spy.mockRestore();
  });

  it('malformed JSON is the client\'s fault: 400 VALIDATION_ERROR, not 500', async () => {
    const res = await request(makeApp((_req, res2) => res2.json({}))).post('/x')
      .set('Content-Type', 'application/json')
      .send('{"ids": [');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('an oversized body is 413, not 500', async () => {
    const app = express();
    app.use(express.json({ limit: '10b' }));
    app.post('/x', (_req, res) => res.json({}));
    app.use(errorHandler);
    const res = await request(app).post('/x').send({ big: 'x'.repeat(100) });
    expect(res.status).toBe(413);
  });
});

describe('process-level policy', () => {
  it('unhandledRejection: logged at ERROR, process kept alive (no shutdown)', () => {
    const proc = new EventEmitter();
    const shutdown = jest.fn();
    const spy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    const uninstall = installProcessHandlers({ shutdown, proc: proc as any });

    proc.emit('unhandledRejection', new Error('background promise failed'));

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'process.unhandledRejection' }),
      expect.stringContaining('unhandled promise rejection'),
    );
    expect(shutdown).not.toHaveBeenCalled();
    uninstall();
    spy.mockRestore();
  });

  it('uncaughtException: logged FATAL and a graceful shutdown with exit code 1', () => {
    const proc = new EventEmitter();
    const shutdown = jest.fn();
    const spy = jest.spyOn(logger, 'fatal').mockImplementation(() => undefined as never);
    const uninstall = installProcessHandlers({ shutdown, proc: proc as any });

    proc.emit('uncaughtException', new Error('invariant broken'));

    expect(spy).toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledWith('uncaughtException', 1);
    uninstall();
    spy.mockRestore();
  });

  it('uninstall removes both listeners', () => {
    const proc = new EventEmitter();
    const uninstall = installProcessHandlers({ shutdown: jest.fn(), proc: proc as any });
    expect(proc.listenerCount('unhandledRejection')).toBe(1);
    expect(proc.listenerCount('uncaughtException')).toBe(1);
    uninstall();
    expect(proc.listenerCount('unhandledRejection')).toBe(0);
    expect(proc.listenerCount('uncaughtException')).toBe(0);
  });
});

describe('edge validation — nothing malformed reaches Postgres', () => {
  const dbCalls = () => (db as any).raw.mock.calls.length + (db as any).transaction.mock.calls.length;
  beforeEach(() => {
    (db as any).raw.mockClear();
    (db as any).transaction.mockClear();
  });

  it('the review\'s exact payload — POST /v1/resolve {"ids":["front_sli_\\u0000"]} — is 400, not a DB error', async () => {
    const res = await request(createApp())
      .post('/v1/resolve')
      .set(auth)
      .set('Content-Type', 'application/json')
      .send('{"ids":["front_sli_\\u0000"]}');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(dbCalls()).toBe(0);
  });

  it.each([
    ['NUL in a path id', 'get', `/v1/selection-lists/front_sl_%00`],
    ['NUL in a query value', 'get', `/v1/selection-lists?key=a%00b`],
    ['NUL in a query key', 'get', `/v1/selection-lists?a%00b=1`],
    ['malformed percent-escape in the path', 'get', `/v1/selection-lists/front_sl_%E0%A4%A`],
  ])('%s -> 400 VALIDATION_ERROR', async (_n, method, path) => {
    const res = await (request(createApp()) as any)[method](path).set(auth);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(dbCalls()).toBe(0);
  });

  it('NUL in any JSON body string (nested, or an object key) -> 400', async () => {
    const app = createApp();
    for (const body of [
      '{"key":"a\\u0000b","name":"n"}',
      '{"key":"k","name":"n","description":"x\\u0000"}',
      '{"nested":{"deep":["ok","b\\u0000d"]}}',
      '{"a\\u0000b":1}',
    ]) {
      const res = await request(app)
        .post('/v1/selection-lists')
        .set(auth)
        .set('Content-Type', 'application/json')
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect(dbCalls()).toBe(0);
  });

  it.each([
    ['a non-prefixed listId', '/v1/selection-lists/not-an-id'],
    ['an item id used as a list id (type confusion)', `/v1/selection-lists/${ITEM}`],
    ["a list id used as an item id", `/v1/selection-lists/${LIST}/items/${LIST}/translations`],
    ['an uppercase / illegal-character suffix', '/v1/selection-lists/front_sl_ABC'],
    ['an over-long id (> 255)', `/v1/selection-lists/front_sl_${'a'.repeat(300)}`],
    ['a malformed itemId on a nested translations route', `/v1/selection-lists/${LIST}/items/nope/translations`],
  ])('%s -> 400 VALIDATION_ERROR (before any DB / authz work)', async (_n, path) => {
    const res = await request(createApp()).get(path).set(auth);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(dbCalls()).toBe(0);
  });

  it('authentication still comes first: an unauthenticated NUL request is 401', async () => {
    const res = await request(createApp()).get('/v1/selection-lists/front_sl_%00');
    expect(res.status).toBe(401);
  });

  it('contract-valid ids are NOT rejected (a never-minted id must still reach the 404 path)', async () => {
    // The frozen contract pattern is ^front_sl_[0-9a-z]+$ (any length); strict
    // TypeID suffix parsing would turn these into 400s.
    for (const id of ['front_sl_nonexistent0000000000', 'front_sl_01h455vb4pex5vsknk084sn02q']) {
      expect(isListId(id)).toBe(true);
    }
    expect(isItemId('front_sli_nonexistent000000000')).toBe(true);
    expect(isUserId('usr_01h455vb4pex5vsknk084sn02q')).toBe(true);
  });

  it('the id matchers are built from the identity registry prefixes (no drift)', () => {
    expect(isListId(`${ENTITY_PREFIXES.selectionList}_abc123`)).toBe(true);
    expect(isItemId(`${ENTITY_PREFIXES.selectionListItem}_abc123`)).toBe(true);
    expect(isUserId(`${ENTITY_PREFIXES.user}_abc123`)).toBe(true);
    expect(isListId(`${ENTITY_PREFIXES.selectionListItem}_abc123`)).toBe(false);
  });

  it('containsNul scans deeply and refuses pathological nesting', () => {
    expect(containsNul({ a: [{ b: 'ok' }, 'x\u0000'] })).toBe(true);
    expect(containsNul({ a: [{ b: 'ok' }] })).toBe(false);
    let deep: any = 'x';
    for (let i = 0; i < 100; i++) deep = [deep];
    expect(containsNul(deep)).toBe(true);
  });
});
