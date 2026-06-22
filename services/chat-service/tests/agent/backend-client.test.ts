// backend-client.test.ts — mutating tools call fuzefront-backend through this
// client. Asserts URL/method/headers/body and error-on-non-2xx. fetch mocked.

import { BackendActionClient } from '../../src/agent/backend-client';

function makeFetch(impl: (url: string, init: RequestInit) => any) {
  const calls: any[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return impl(url, init);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const OK = (json: any) => ({ ok: true, status: 200, json: async () => json });

describe('BackendActionClient', () => {
  it('createOrg POSTs /api/organizations with bearer token and body', async () => {
    const { fetchImpl, calls } = makeFetch(() => OK({ id: 'org-9', name: 'Acme' }));
    const client = new BackendActionClient({ baseUrl: 'http://backend:3001', fetchImpl });
    const out = await client.createOrg('jwt-abc', {
      name: 'Acme',
      slug: 'acme',
      description: 'd',
    });

    expect(out).toEqual({ id: 'org-9', name: 'Acme' });
    expect(calls[0].url).toBe('http://backend:3001/api/organizations');
    expect(calls[0].method).toBe('POST');
    expect((calls[0].headers as any).Authorization).toBe('Bearer jwt-abc');
    expect((calls[0].headers as any)['Content-Type']).toBe('application/json');
    expect(calls[0].body).toEqual({ name: 'Acme', slug: 'acme', description: 'd' });
  });

  it('createOrg omits description when not provided', async () => {
    const { fetchImpl, calls } = makeFetch(() => OK({ id: 'o' }));
    const client = new BackendActionClient({ baseUrl: 'http://backend:3001', fetchImpl });
    await client.createOrg('t', { name: 'Acme', slug: 'acme' });
    expect(calls[0].body).toEqual({ name: 'Acme', slug: 'acme' });
  });

  it('inviteMember POSTs /api/organizations/:id/invitations', async () => {
    const { fetchImpl, calls } = makeFetch(() => OK({ ok: true }));
    const client = new BackendActionClient({ baseUrl: 'http://backend:3001', fetchImpl });
    await client.inviteMember('t', { orgId: 'org-1', email: 'a@b.c', role: 'member' });
    expect(calls[0].url).toBe('http://backend:3001/api/organizations/org-1/invitations');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ email: 'a@b.c', role: 'member' });
  });

  it('updateOrgSettings PUTs /api/organizations/:id with settings', async () => {
    const { fetchImpl, calls } = makeFetch(() => OK({ ok: true }));
    const client = new BackendActionClient({ baseUrl: 'http://backend:3001', fetchImpl });
    await client.updateOrgSettings('t', { orgId: 'org-1', settings: { name: 'New' } });
    expect(calls[0].url).toBe('http://backend:3001/api/organizations/org-1');
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].body).toEqual({ name: 'New' });
  });

  it('strips a trailing slash from baseUrl', async () => {
    const { fetchImpl, calls } = makeFetch(() => OK({}));
    const client = new BackendActionClient({ baseUrl: 'http://backend:3001/', fetchImpl });
    await client.createOrg('t', { name: 'A', slug: 'a' });
    expect(calls[0].url).toBe('http://backend:3001/api/organizations');
  });

  it('throws on a non-2xx response', async () => {
    const { fetchImpl } = makeFetch(() => ({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    }));
    const client = new BackendActionClient({ baseUrl: 'http://backend:3001', fetchImpl });
    await expect(client.createOrg('t', { name: 'A', slug: 'a' })).rejects.toThrow(/403/);
  });
});
