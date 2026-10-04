/**
 * Input hardening + operability — black-box, against the running service and a
 * real Postgres (review H-4).
 *
 * A NUL byte in a text parameter makes Postgres raise SQLSTATE 22021. Before the
 * fix, a route that awaited the query outside its own try/catch turned that into
 * an unhandled rejection, which terminates a Node process — one request from any
 * org member killed the only replica. The assertions here are behavioural:
 *   - the malformed request is a 400 VALIDATION_ERROR (never a 500, never a hang)
 *   - and the service is STILL UP afterwards (/health, /ready)
 * plus the probe/scrape endpoints exist and expose no ids.
 */

import { rawFetch, SERVICE_BASE_URL } from '../helpers/client';
import { mintTestToken } from '../helpers/auth';

const ORG = 'org_01test00000000hardening000';
const USER = 'usr_01test00000000hardening000';
const token = () => mintTestToken({ userId: USER, organizationId: ORG });

async function expectAlive(): Promise<void> {
  const health = await fetch(`${SERVICE_BASE_URL}/health`);
  expect(health.status).toBe(200);
  const ready = await fetch(`${SERVICE_BASE_URL}/ready`);
  expect(ready.status).toBe(200);
  expect(await ready.json()).toMatchObject({ status: 'ready', checks: { db: 'ok' } });
}

describe('malformed input is a 400 and never takes the service down', () => {
  it('POST /v1/resolve {"ids":["front_sli_<NUL>"]} (the review\'s payload) -> 400 VALIDATION_ERROR', async () => {
    const res = await rawFetch('/v1/resolve', {
      method: 'POST',
      token: token(),
      body: '{"ids":["front_sli_\\u0000"]}',
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    await expectAlive();
  });

  it.each([
    ['NUL in a path id', 'GET', '/v1/selection-lists/front_sl_%00', undefined],
    ['NUL in the query string', 'GET', '/v1/selection-lists?key=a%00b', undefined],
    ['a non-prefixed list id', 'GET', '/v1/selection-lists/not-an-id', undefined],
    ['an item id where a list id belongs (type confusion)', 'GET', '/v1/selection-lists/front_sli_abc123/items', undefined],
    ['NUL in a create body', 'POST', '/v1/selection-lists', '{"key":"a\\u0000b","name":"n"}'],
    ['malformed JSON', 'POST', '/v1/selection-lists', '{"key":'],
  ])('%s -> 400 VALIDATION_ERROR', async (_label, method, path, body) => {
    const res = await rawFetch(path, { method, token: token(), body });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('survives a burst of malformed requests (it must still be answering afterwards)', async () => {
    const burst = Array.from({ length: 25 }, (_, i) =>
      rawFetch(i % 2 ? '/v1/resolve' : '/v1/selection-lists/front_sl_%00', {
        method: i % 2 ? 'POST' : 'GET',
        token: token(),
        body: i % 2 ? '{"ids":["front_sli_\\u0000"]}' : undefined,
      }),
    );
    for (const r of await Promise.all(burst)) expect(r.status).toBe(400);
    await expectAlive();
  });

  it('a well-formed id that does not exist is still a 404, not a 400 (contract shape, never-minted id)', async () => {
    const res = await rawFetch('/v1/selection-lists/front_sl_nonexistent0000000000', { token: token() });
    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(400);
  });

  it('authentication still comes first: a NUL request with no token is 401', async () => {
    const res = await rawFetch('/v1/selection-lists/front_sl_%00');
    expect(res.status).toBe(401);
  });
});

describe('probes and metrics', () => {
  it('/ready checks the DB and is unauthenticated', async () => {
    const res = await fetch(`${SERVICE_BASE_URL}/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready', service: 'selection-list-service', checks: { db: 'ok' } });
  });

  it('/metrics is unauthenticated Prometheus text with the request histogram and no ids in labels', async () => {
    await rawFetch('/v1/selection-lists/front_sl_nonexistent0000000000', { token: token() });
    const res = await fetch(`${SERVICE_BASE_URL}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const text = await res.text();
    expect(text).toContain('http_request_duration_seconds_bucket');
    expect(text).toContain('process_cpu_user_seconds_total');
    expect(text).not.toMatch(/route="[^"]*(front_sl_|front_sli_|usr_|org_)/);
  });
});
