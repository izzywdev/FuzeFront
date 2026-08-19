/**
 * @fuzefront/auth — authz client + requirePermission guard.
 *
 * Every test injects a mock fetch; nothing here touches a network. The bias of
 * this suite is deliberate: most cases assert that something is DENIED, because
 * the only truly expensive bug in this module is an unauthorized allow.
 */

import type { NextFunction, Request, Response } from 'express';
import { createAuthzClient } from '../src/authzClient';
import { requirePermission } from '../src/authzMiddleware';
import { AuthzCheck, AuthzError, FetchLike } from '../src/authzTypes';
import type { Identity } from '../src/types';

const BASE = 'https://app.fuzefront.com';
const TOKEN = 'caller-token-abc';

const IDENTITY: Identity = {
  userId: 'user_1',
  tenantId: 'tenant_1',
  roles: [],
  authMode: 'legacy-hs256',
};

/** A mock fetch that answers with `status` + `body`, recording every call. */
function mockFetch(
  responses: Array<{ status?: number; body?: unknown } | Error>,
): FetchLike & { calls: Array<{ url: string; init: any }> } {
  let i = 0;
  const calls: Array<{ url: string; init: any }> = [];
  const fn = (async (url: string, init: any) => {
    calls.push({ url, init });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (next instanceof Error) throw next;
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => next.body,
    };
  }) as FetchLike & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

/** Minimal Express req/res doubles. */
function mockReq(over: Partial<Request> = {}): Request {
  return {
    headers: { authorization: `Bearer ${TOKEN}` },
    params: {},
    identity: IDENTITY,
    ...over,
  } as unknown as Request;
}

function mockRes(): Response & { statusCode?: number; body?: any } {
  const res: any = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: any) => {
    res.body = body;
    return res;
  });
  return res as Response & { statusCode?: number; body?: any };
}

/** Run the guard and resolve once next() or res.json() has fired. */
async function run(
  mw: (req: Request, res: Response, next: NextFunction) => void,
  req: Request,
): Promise<{ res: any; nextCalled: boolean }> {
  const res = mockRes();
  let nextCalled = false;
  await new Promise<void>((done) => {
    const next: NextFunction = (() => {
      nextCalled = true;
      done();
    }) as NextFunction;
    res.json = jest.fn((body: any) => {
      (res as any).body = body;
      done();
      return res;
    });
    mw(req, res, next);
  });
  return { res, nextCalled };
}

const CHECK: AuthzCheck = {
  subject: 'user_1',
  tenant: 'tenant_1',
  resource: { type: 'invoice' },
  action: 'read',
};

describe('createAuthzClient', () => {
  it('posts to the Security API authz/check with the caller bearer token', async () => {
    const fetch = mockFetch([{ body: { allow: true } }]);
    const client = createAuthzClient({ baseUrl: BASE, fetch });

    await expect(client.check(CHECK, TOKEN)).resolves.toEqual({ allow: true });

    expect(fetch.calls[0].url).toBe(`${BASE}/api/v1/security/authz/check`);
    expect(fetch.calls[0].init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(fetch.calls[0].init.body)).toEqual(CHECK);
  });

  it('returns allow:false for a policy denial (a denial is a decision, not an error)', async () => {
    const client = createAuthzClient({ baseUrl: BASE, fetch: mockFetch([{ body: { allow: false } }]) });
    await expect(client.check(CHECK, TOKEN)).resolves.toEqual({ allow: false });
  });

  it('throws DECISION_UNAVAILABLE on a 500 rather than resolving allow', async () => {
    const client = createAuthzClient({ baseUrl: BASE, fetch: mockFetch([{ status: 500, body: {} }]) });
    await expect(client.check(CHECK, TOKEN)).rejects.toMatchObject({ code: 'DECISION_UNAVAILABLE' });
  });

  it('throws DECISION_UNAVAILABLE when the response has no boolean allow', async () => {
    const client = createAuthzClient({ baseUrl: BASE, fetch: mockFetch([{ body: { allow: 'yes' } }]) });
    await expect(client.check(CHECK, TOKEN)).rejects.toMatchObject({ code: 'DECISION_UNAVAILABLE' });
  });

  it('maps bulk-check decisions index-aligned with the request checks', async () => {
    const checks: AuthzCheck[] = [
      { ...CHECK, resource: { type: 'invoice', key: 'a' } },
      { ...CHECK, resource: { type: 'invoice', key: 'b' } },
      { ...CHECK, resource: { type: 'invoice', key: 'c' } },
    ];
    const fetch = mockFetch([
      { body: { decisions: [{ allow: true }, { allow: false }, { allow: true }] } },
    ]);
    const client = createAuthzClient({ baseUrl: BASE, fetch });

    const decisions = await client.bulkCheck(checks, TOKEN);

    expect(decisions).toEqual([{ allow: true }, { allow: false }, { allow: true }]);
    expect(fetch.calls[0].url).toBe(`${BASE}/api/v1/security/authz/bulk-check`);
    expect(JSON.parse(fetch.calls[0].init.body)).toEqual({ checks });
  });

  it('denies the WHOLE bulk batch when the response length cannot be index-aligned', async () => {
    const checks = [CHECK, { ...CHECK, action: 'write' }];
    const client = createAuthzClient({
      baseUrl: BASE,
      // Two questions, one answer — aligning them would be a guess.
      fetch: mockFetch([{ body: { decisions: [{ allow: true }] } }]),
    });
    await expect(client.bulkCheck(checks, TOKEN)).rejects.toMatchObject({
      code: 'DECISION_UNAVAILABLE',
    });
  });
});

describe('createAuthzClient — positive-decision cache', () => {
  it('is OFF by default: a repeated check re-calls the PDP', async () => {
    const fetch = mockFetch([{ body: { allow: true } }]);
    const client = createAuthzClient({ baseUrl: BASE, fetch });

    await client.check(CHECK, TOKEN);
    await client.check(CHECK, TOKEN);

    expect(fetch.calls).toHaveLength(2);
  });

  it('when enabled, a cache hit does not re-call the PDP', async () => {
    const fetch = mockFetch([{ body: { allow: true } }]);
    const client = createAuthzClient({ baseUrl: BASE, fetch, cacheTtlSeconds: 5 });

    await client.check(CHECK, TOKEN);
    await expect(client.check(CHECK, TOKEN)).resolves.toEqual({ allow: true });

    expect(fetch.calls).toHaveLength(1);
  });

  it('never caches a denial as an allow — a repeated denial re-asks and stays denied', async () => {
    const fetch = mockFetch([{ body: { allow: false } }]);
    const client = createAuthzClient({ baseUrl: BASE, fetch, cacheTtlSeconds: 5 });

    await client.check(CHECK, TOKEN);
    await expect(client.check(CHECK, TOKEN)).resolves.toEqual({ allow: false });

    expect(fetch.calls).toHaveLength(2);
  });

  it('never serves one principal a cached allow belonging to another', async () => {
    const fetch = mockFetch([{ body: { allow: true } }, { body: { allow: false } }]);
    const client = createAuthzClient({ baseUrl: BASE, fetch, cacheTtlSeconds: 5 });

    await client.check(CHECK, 'token-alice');
    // Same question, different bearer => must NOT hit alice's cached allow.
    await expect(client.check(CHECK, 'token-mallory')).resolves.toEqual({ allow: false });
    expect(fetch.calls).toHaveLength(2);
  });

  it('re-asks the PDP once the TTL has expired', async () => {
    const fetch = mockFetch([{ body: { allow: true } }]);
    const client = createAuthzClient({ baseUrl: BASE, fetch, cacheTtlSeconds: 5 });
    const now = jest.spyOn(Date, 'now');

    now.mockReturnValue(1_000_000);
    await client.check(CHECK, TOKEN);
    now.mockReturnValue(1_000_000 + 5_001);
    await client.check(CHECK, TOKEN);

    expect(fetch.calls).toHaveLength(2);
    now.mockRestore();
  });
});

describe('requirePermission', () => {
  const clientWith = (responses: Array<{ status?: number; body?: unknown } | Error>) =>
    createAuthzClient({ baseUrl: BASE, fetch: mockFetch(responses) });

  it('calls next() when the decision allows', async () => {
    const mw = requirePermission({
      client: clientWith([{ body: { allow: true } }]),
      resource: 'invoice',
      action: 'read',
    });
    const { nextCalled, res } = await run(mw, mockReq());
    expect(nextCalled).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responds 403 FORBIDDEN when the decision denies', async () => {
    const mw = requirePermission({
      client: clientWith([{ body: { allow: false } }]),
      resource: 'invoice',
      action: 'read',
    });
    const { nextCalled, res } = await run(mw, mockReq());
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('responds 403 — never next() — when the PDP 500s', async () => {
    const mw = requirePermission({
      client: clientWith([{ status: 500, body: {} }]),
      resource: 'invoice',
      action: 'read',
    });
    const { nextCalled, res } = await run(mw, mockReq());
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('DECISION_UNAVAILABLE');
  });

  it('responds 403 — never next() — when the PDP times out', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const mw = requirePermission({
      client: clientWith([timeout]),
      resource: 'invoice',
      action: 'read',
    });
    const { nextCalled, res } = await run(mw, mockReq());
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('DECISION_UNAVAILABLE');
  });

  it('responds 401 IDENTITY_MISSING when mounted without requireAuth (a wiring bug, not a denial)', async () => {
    const mw = requirePermission({
      client: clientWith([{ body: { allow: true } }]),
      resource: 'invoice',
      action: 'read',
    });
    const { nextCalled, res } = await run(mw, mockReq({ identity: undefined }));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('IDENTITY_MISSING');
  });

  it('passes req to dynamic resolvers so the check is instance-level (ReBAC)', async () => {
    const fetch = mockFetch([{ body: { allow: true } }]);
    const seen: Request[] = [];
    const mw = requirePermission({
      client: createAuthzClient({ baseUrl: BASE, fetch }),
      resource: 'invoice',
      action: (req) => {
        seen.push(req);
        return req.method === 'DELETE' ? 'delete' : 'read';
      },
      resourceKey: (req) => req.params.id,
      context: (req) => ({ ip: (req as any).ip }),
    });

    const req = mockReq({ method: 'DELETE', params: { id: 'inv_42' }, ip: '10.0.0.1' } as any);
    const { nextCalled } = await run(mw, req);

    expect(nextCalled).toBe(true);
    expect(seen[0]).toBe(req);
    expect(JSON.parse(fetch.calls[0].init.body)).toEqual({
      subject: 'user_1',
      tenant: 'tenant_1',
      resource: { type: 'invoice', key: 'inv_42' },
      action: 'delete',
      context: { ip: '10.0.0.1' },
    });
  });

  it('denies with TENANT_UNRESOLVED when identity has no tenant and none is configured', async () => {
    const mw = requirePermission({
      client: clientWith([{ body: { allow: true } }]),
      resource: 'invoice',
      action: 'read',
    });
    const req = mockReq({ identity: { ...IDENTITY, tenantId: null } } as any);
    const { nextCalled, res } = await run(mw, req);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('TENANT_UNRESOLVED');
  });

  it('denies when a resolver throws rather than letting the request through', async () => {
    const mw = requirePermission({
      client: clientWith([{ body: { allow: true } }]),
      resource: 'invoice',
      action: 'read',
      resourceKey: () => {
        throw new Error('params shape changed');
      },
    });
    const { nextCalled, res } = await run(mw, mockReq());
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('AUTHZ_MISCONFIGURED');
  });

  it('throws at wiring time when constructed without a client', () => {
    expect(() => requirePermission({ resource: 'x', action: 'y' } as any)).toThrow(AuthzError);
  });
});
