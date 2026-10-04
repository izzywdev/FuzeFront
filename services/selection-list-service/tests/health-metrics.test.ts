// health-metrics.test.ts — probes and scrape endpoint.
//
//   GET /health   liveness: cheap, never touches the DB
//   GET /ready    readiness: DB check with a bounded timeout (200 / 503)
//   GET /metrics  Prometheus: process metrics + http_request_duration_seconds,
//                 low-cardinality labels (no ids)
// All three are unauthenticated (like /health, they are mounted before the /v1 gate).

jest.mock('../src/db', () => {
  const db: any = jest.fn();
  db.raw = jest.fn();
  return { db };
});

import request from 'supertest';
import { createApp } from '../src/app';
import { db } from '../src/db';
import { checkDb } from '../src/routes/health';
import { routeLabel } from '../src/lib/metrics';

const raw = (db as any).raw as jest.Mock;

beforeEach(() => raw.mockReset());

describe('GET /health (liveness)', () => {
  it('is 200 and does NOT touch the database', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'selection-list-service' });
    expect(raw).not.toHaveBeenCalled();
  });

  it('stays 200 even when the DB is down (a flapping dependency must not restart the pod)', async () => {
    raw.mockRejectedValue(new Error('connection refused'));
    expect((await request(createApp()).get('/health')).status).toBe(200);
  });
});

describe('GET /ready (readiness)', () => {
  it('is 200 and reports db: ok when SELECT 1 succeeds', async () => {
    raw.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const res = await request(createApp()).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', service: 'selection-list-service', checks: { db: 'ok' } });
    expect(raw).toHaveBeenCalledWith('select 1');
  });

  it('is 503 with db: error when the DB query fails', async () => {
    raw.mockRejectedValue(new Error('connection refused'));
    const res = await request(createApp()).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', service: 'selection-list-service', checks: { db: 'error' } });
    // The driver error never leaks into the body.
    expect(JSON.stringify(res.body)).not.toContain('refused');
  });

  it('is 503 with db: timeout when the DB hangs — the probe is bounded, not hung', async () => {
    raw.mockReturnValue(new Promise(() => undefined)); // never settles
    const started = Date.now();
    const state = await checkDb({ raw } as any, 50);
    expect(state).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('is unauthenticated (no bearer token needed)', async () => {
    raw.mockResolvedValue({});
    expect((await request(createApp()).get('/ready')).status).toBe(200);
  });
});

describe('GET /metrics', () => {
  it('is unauthenticated and serves the Prometheus text format with default process metrics', async () => {
    const res = await request(createApp()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('process_cpu_user_seconds_total');
    expect(res.text).toContain('# TYPE http_request_duration_seconds histogram');
  });

  it('records the request histogram labelled by method, MATCHED ROUTE PATTERN and status — never an id', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'unit-test-secret';
    const app = createApp();
    await request(app).get('/health');
    // A /v1 request that fails auth: no route matched -> constant "unmatched" label.
    await request(app).get('/v1/selection-lists/front_sl_0123456789abcdefghjkmnpqrs').set('Authorization', 'Bearer bad');
    await request(app).get('/definitely/not/a/route/with/an/id/front_sl_0123456789abcdefghjkmnpqrs');

    const body = (await request(app).get('/metrics')).text;
    expect(body).toMatch(/http_request_duration_seconds_count\{[^}]*method="GET"[^}]*route="\/health"[^}]*status_code="200"[^}]*\}/);
    expect(body).toMatch(/route="unmatched"[^}]*status_code="(401|404)"|status_code="(401|404)"[^}]*route="unmatched"/);
    // Cardinality guard: no id, user or org value can ever appear as a label.
    expect(body).not.toContain('front_sl_0123456789abcdefghjkmnpqrs');
    expect(body).not.toMatch(/route="[^"]*(front_sl_|front_sli_|usr_|org_)/);
    // Labels are exactly method / route / status_code (+ the service default label).
    const hist = body.split('\n').find((l) => l.startsWith('http_request_duration_seconds_count'));
    expect(hist).toBeDefined();
    const labelNames = [...(hist as string).matchAll(/(\w+)="/g)].map((m) => m[1]).sort();
    expect(labelNames).toEqual(['method', 'route', 'service', 'status_code']);
  });

  it('a matched parameterised route is labelled by its PATTERN (:listId), not the concrete id; unmatched is constant', () => {
    expect(routeLabel({ baseUrl: '/v1/selection-lists', route: { path: '/:listId/items' } } as any)).toBe(
      '/v1/selection-lists/:listId/items',
    );
    expect(routeLabel({ baseUrl: '', route: undefined } as any)).toBe('unmatched');
  });

  it('the scrape endpoint itself is not recorded in the histogram', async () => {
    const app = createApp();
    await request(app).get('/metrics');
    const body = (await request(app).get('/metrics')).text;
    expect(body).not.toMatch(/route="\/metrics"/);
  });
});
