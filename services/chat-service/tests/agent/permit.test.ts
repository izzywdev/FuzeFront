// permit.test.ts — PDP REST client. Calls the local PDP /allowed endpoint
// (plan §6c step 2). Fails CLOSED (deny) on any error (§10c). HTTP mocked.

import { PermitClient } from '../../src/agent/permit';

function makeFetch(impl: (url: string, init: RequestInit) => any) {
  const calls: any[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined });
    return impl(url, init);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('PermitClient.check', () => {
  it('POSTs to /allowed with user/action/resource+tenant and returns allow=true', async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ allow: true }),
    }));
    const permit = new PermitClient({ pdpUrl: 'http://pdp:7000', fetchImpl });
    const allowed = await permit.check({
      user: 'user-1',
      action: 'create',
      resource: 'organization',
      tenant: 'org-1',
    });
    expect(allowed).toBe(true);
    expect(calls[0].url).toBe('http://pdp:7000/allowed');
    expect(calls[0].body.user.key).toBe('user-1');
    expect(calls[0].body.action).toBe('create');
    expect(calls[0].body.resource.type).toBe('organization');
    expect(calls[0].body.resource.tenant).toBe('org-1');
  });

  it('returns false when the PDP denies', async () => {
    const { fetchImpl } = makeFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ allow: false }),
    }));
    const permit = new PermitClient({ pdpUrl: 'http://pdp:7000', fetchImpl });
    const allowed = await permit.check({
      user: 'u',
      action: 'create',
      resource: 'organization',
      tenant: 't',
    });
    expect(allowed).toBe(false);
  });

  it('fails closed (deny) when the PDP errors', async () => {
    const { fetchImpl } = makeFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const permit = new PermitClient({ pdpUrl: 'http://pdp:7000', fetchImpl });
    const allowed = await permit.check({ user: 'u', action: 'a', resource: 'r', tenant: 't' });
    expect(allowed).toBe(false);
  });

  it('fails closed (deny) when fetch throws', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const permit = new PermitClient({ pdpUrl: 'http://pdp:7000', fetchImpl });
    const allowed = await permit.check({ user: 'u', action: 'a', resource: 'r', tenant: 't' });
    expect(allowed).toBe(false);
  });
});
