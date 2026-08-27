// securityApiPermitAdapter.test.ts — Security-API-wrapped authz check
// (FuzeFront#254). Verifies: request shape sent to the Security API, allow /
// deny mapping, and fail-closed behavior on every error path (missing token,
// non-2xx, network error) — same fail-closed contract as permit.test.ts's
// direct-PDP `PermitClient`, so the two are drop-in interchangeable behind
// `agent/authzGateway.ts`.

import { SecurityApiPermitAdapter } from '../../src/agent/securityApiPermitAdapter';
import type { AuthzClient, AuthzCheck } from '@fuzefront/auth';

describe('SecurityApiPermitAdapter.check — injected AuthzClient', () => {
  it('maps a PermitCheck onto AuthzCheck and returns allow=true', async () => {
    const check = jest.fn().mockResolvedValue({ allow: true });
    const client: AuthzClient = { check, bulkCheck: jest.fn() } as any;
    const adapter = new SecurityApiPermitAdapter({ securityServiceUrl: 'http://sec:3002', client });

    const allowed = await adapter.check({
      user: 'user-1',
      action: 'create',
      resource: 'organization',
      tenant: 'org-1',
      attributes: { args: { name: 'Acme' } },
      token: 'caller-jwt',
    });

    expect(allowed).toBe(true);
    const [sentCheck, sentToken] = check.mock.calls[0] as [AuthzCheck, string];
    expect(sentCheck).toEqual({
      subject: 'user-1',
      tenant: 'org-1',
      resource: { type: 'organization' },
      action: 'create',
      context: { args: { name: 'Acme' } },
    });
    expect(sentToken).toBe('caller-jwt');
  });

  it('returns false when the Security API denies', async () => {
    const check = jest.fn().mockResolvedValue({ allow: false });
    const client: AuthzClient = { check, bulkCheck: jest.fn() } as any;
    const adapter = new SecurityApiPermitAdapter({ securityServiceUrl: 'http://sec:3002', client });

    const allowed = await adapter.check({
      user: 'u',
      action: 'read',
      resource: 'docs',
      tenant: 'org-1',
      token: 'tok',
    });

    expect(allowed).toBe(false);
  });

  it('fails closed (deny) with no token — never asks the Security API to guess an identity', async () => {
    const check = jest.fn();
    const client: AuthzClient = { check, bulkCheck: jest.fn() } as any;
    const adapter = new SecurityApiPermitAdapter({ securityServiceUrl: 'http://sec:3002', client });

    const allowed = await adapter.check({
      user: 'u',
      action: 'read',
      resource: 'docs',
      tenant: 'org-1',
      // no token
    });

    expect(allowed).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('fails closed (deny) when the client throws (DECISION_UNAVAILABLE)', async () => {
    const check = jest.fn().mockRejectedValue(new Error('Security API unreachable'));
    const client: AuthzClient = { check, bulkCheck: jest.fn() } as any;
    const adapter = new SecurityApiPermitAdapter({ securityServiceUrl: 'http://sec:3002', client });

    const allowed = await adapter.check({
      user: 'u',
      action: 'read',
      resource: 'docs',
      tenant: 'org-1',
      token: 'tok',
    });

    expect(allowed).toBe(false);
  });
});

describe('SecurityApiPermitAdapter.check — real createAuthzClient wiring', () => {
  function makeFetch(impl: (url: string, init: RequestInit) => any) {
    const calls: any[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body as string) : undefined });
      return impl(url, init);
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it('POSTs to /api/v1/security/authz/check with the caller bearer token', async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ allow: true }),
    }));
    const adapter = new SecurityApiPermitAdapter({ securityServiceUrl: 'http://fuzefront-security:3002', fetchImpl });

    const allowed = await adapter.check({
      user: 'user-1',
      action: 'create',
      resource: 'organization',
      tenant: 'org-1',
      token: 'caller-jwt',
    });

    expect(allowed).toBe(true);
    expect(calls[0].url).toBe('http://fuzefront-security:3002/api/v1/security/authz/check');
    expect((calls[0].headers as any).authorization).toBe('Bearer caller-jwt');
    expect(calls[0].body).toEqual({
      subject: 'user-1',
      tenant: 'org-1',
      resource: { type: 'organization' },
      action: 'create',
      context: undefined,
    });
  });

  it('fails closed (deny) on a non-2xx response', async () => {
    const { fetchImpl } = makeFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const adapter = new SecurityApiPermitAdapter({ securityServiceUrl: 'http://fuzefront-security:3002', fetchImpl });

    const allowed = await adapter.check({
      user: 'u',
      action: 'a',
      resource: 'r',
      tenant: 't',
      token: 'tok',
    });

    expect(allowed).toBe(false);
  });
});
