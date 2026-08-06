import { describe, it, expect, vi } from 'vitest';
import { buildTools, type OpenApiDoc } from '../src/spec.js';
import { buildRequest, callUpstream, extractForwardHeaders, MissingIdentityError } from '../src/upstream.js';

const doc: OpenApiDoc = {
  paths: {
    '/tickets/{ticketId}': {
      get: {
        operationId: 'getTicket',
        parameters: [
          { name: 'ticketId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'expand', in: 'query', schema: { type: 'string' } },
        ],
      },
    },
    '/tickets': {
      post: {
        operationId: 'createTicket',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    },
  },
};

const tools = Object.fromEntries(buildTools(doc).map(t => [t.name, t]));
const BASE = 'http://fuzeservice-service.fuzeservice.svc.cluster.local:8080/v1';

describe('buildRequest', () => {
  it('substitutes path params and appends query params', () => {
    const { url } = buildRequest(tools.getTicket, { ticketId: 'T-1', expand: 'sla' }, BASE);
    expect(url).toBe(`${BASE}/tickets/T-1?expand=sla`);
  });

  it('url-encodes path params', () => {
    const { url } = buildRequest(tools.getTicket, { ticketId: 'a/b' }, BASE);
    expect(url).toBe(`${BASE}/tickets/a%2Fb`);
  });

  it('throws rather than sending a request with an unresolved path param', () => {
    expect(() => buildRequest(tools.getTicket, {}, BASE)).toThrow(/Missing required parameter/);
  });

  it('serialises the body and sets content-type', () => {
    const { body, headers } = buildRequest(tools.createTicket, { body: { subject: 'hi' } }, BASE);
    expect(body).toBe('{"subject":"hi"}');
    expect(headers['content-type']).toBe('application/json');
  });
});

describe('identity forwarding', () => {
  it('forwards only the allowlisted caller headers', () => {
    const out = extractForwardHeaders({
      headers: {
        authorization: 'Bearer user-token',
        'x-request-id': 'req-1',
        cookie: 'session=secret',
        'x-forwarded-for': '1.2.3.4',
      },
    });
    expect(out).toEqual({ authorization: 'Bearer user-token', 'x-request-id': 'req-1' });
    expect(out.cookie).toBeUndefined();
  });

  it("sends the caller's token upstream verbatim", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"id":"T-1"}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    await callUpstream(
      tools.getTicket,
      { ticketId: 'T-1' },
      BASE,
      { headers: { authorization: 'Bearer user-token' } },
      fetchImpl as unknown as typeof fetch
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer user-token');
  });

  it('fails closed when the caller presents no identity', async () => {
    const fetchImpl = vi.fn();
    await expect(
      callUpstream(tools.getTicket, { ticketId: 'T-1' }, BASE, { headers: {} }, fetchImpl as unknown as typeof fetch)
    ).rejects.toBeInstanceOf(MissingIdentityError);
    // The decisive assertion: no request was made at all. An unauthenticated
    // call must never reach the product API, because the product would then be
    // deciding authorization for an anonymous caller.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parses a JSON error body and reports it as an error result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"error":"forbidden"}', { status: 403 })
    );
    const res = await callUpstream(
      tools.getTicket,
      { ticketId: 'T-1' },
      BASE,
      { headers: { authorization: 'Bearer u' } },
      fetchImpl as unknown as typeof fetch
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
  });
});
