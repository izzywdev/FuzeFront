/**
 * @fuzefront/service-auth — verifier tests.
 *
 * The central property under test: `POST /tokens/introspect` ALWAYS answers
 * HTTP 200, so a caller that branches on status code instead of the `active`
 * boolean in the body fails OPEN (every 200 looks like success). The very
 * first test below is that exact scenario. Everything else here is the same
 * fail-closed rule applied to every other ambiguity.
 */
import { createMachineTokenVerifier } from '../src/verifier';
import { ServiceAuthError } from '../src/types';
import type { FetchLike } from '../src/types';

function mockFetch(impl: (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>): FetchLike {
  return jest.fn(impl) as unknown as FetchLike;
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('createMachineTokenVerifier — fail-closed introspection', () => {
  it('THE test: rejects an inactive token even though introspection answered HTTP 200', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { active: false }));
    const verifier = createMachineTokenVerifier({ baseUrl: 'http://security.local/api', fetch, cacheTtlSeconds: 0 });

    await expect(verifier.verifyMachineToken('some-token')).rejects.toMatchObject({
      code: 'TOKEN_INACTIVE',
    });
    // Prove the call really was a 200 — a status-code-only check would have
    // treated this as success.
    const res = await fetch('http://security.local/api/v1/security/tokens/introspect');
    expect(res.status).toBe(200);
  });

  it('accepts an active token and returns a normalized identity', async () => {
    const fetch = mockFetch(async () =>
      jsonResponse(200, { active: true, subject: 'svc-billing', tenantId: 'org_1', scope: 'invoices:read invoices:write', expiresAt: 9999999999 }),
    );
    const verifier = createMachineTokenVerifier({ baseUrl: 'http://security.local/api', fetch, cacheTtlSeconds: 0 });

    const identity = await verifier.verifyMachineToken('good-token');
    expect(identity.subject).toBe('svc-billing');
    expect(identity.tenantId).toBe('org_1');
    expect(identity.scopes).toEqual(['invoices:read', 'invoices:write']);
  });

  it('fails closed on a network error (never returns a permissive identity)', async () => {
    const fetch = mockFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    const verifier = createMachineTokenVerifier({ baseUrl: 'http://security.local/api', fetch });

    await expect(verifier.verifyMachineToken('t')).rejects.toMatchObject({
      code: 'INTROSPECTION_UNAVAILABLE',
    });
  });

  it('fails closed on a timeout', async () => {
    jest.useFakeTimers();
    try {
      const fetch: FetchLike = jest.fn((_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }) as unknown as FetchLike;
      const verifier = createMachineTokenVerifier({ baseUrl: 'http://security.local/api', fetch, timeoutMs: 100 });

      const pending = verifier.verifyMachineToken('t');
      const assertion = expect(pending).rejects.toMatchObject({ code: 'INTROSPECTION_UNAVAILABLE' });
      await jest.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails closed on a malformed body (missing `active`)', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { subject: 'x' }));
    const verifier = createMachineTokenVerifier({ baseUrl: 'http://security.local/api', fetch });

    await expect(verifier.verifyMachineToken('t')).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });
  });

  it('fails closed when `active` is not a boolean', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { active: 'true' }));
    const verifier = createMachineTokenVerifier({ baseUrl: 'http://security.local/api', fetch });

    await expect(verifier.verifyMachineToken('t')).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });
  });

  it('fails closed on a non-JSON body', async () => {
    const fetch = mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }));
    const verifier = createMachineTokenVerifier({ baseUrl: 'http://security.local/api', fetch });

    await expect(verifier.verifyMachineToken('t')).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });
  });

  it('fails closed on an active result missing `subject`', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { active: true }));
    const verifier = createMachineTokenVerifier({ baseUrl: 'http://security.local/api', fetch });

    await expect(verifier.verifyMachineToken('t')).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });
  });

  it('fails closed on an unexpected non-200 status (contract says introspect always answers 200)', async () => {
    const fetch = mockFetch(async () => jsonResponse(502, { active: true, subject: 'x' }));
    const verifier = createMachineTokenVerifier({ baseUrl: 'http://security.local/api', fetch });

    await expect(verifier.verifyMachineToken('t')).rejects.toMatchObject({
      code: 'INTROSPECTION_UNAVAILABLE',
    });
  });

  it('caches a POSITIVE result and does not re-introspect within the TTL', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { active: true, subject: 'svc-a', expiresAt: Math.floor(Date.now() / 1000) + 3600 }));
    const verifier = createMachineTokenVerifier({ baseUrl: 'http://security.local/api', fetch, cacheTtlSeconds: 60 });

    await verifier.verifyMachineToken('cache-me');
    await verifier.verifyMachineToken('cache-me');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('NEVER caches a NEGATIVE result — a revoked token is re-checked every time', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { active: false }));
    const verifier = createMachineTokenVerifier({ baseUrl: 'http://security.local/api', fetch, cacheTtlSeconds: 60 });

    await expect(verifier.verifyMachineToken('revoked')).rejects.toMatchObject({ code: 'TOKEN_INACTIVE' });
    await expect(verifier.verifyMachineToken('revoked')).rejects.toMatchObject({ code: 'TOKEN_INACTIVE' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws MISCONFIGURED when constructed without a baseUrl', () => {
    expect(() => createMachineTokenVerifier({} as any)).toThrow(ServiceAuthError);
  });

  it('rejects verifying an empty token without making a network call', async () => {
    const fetch = mockFetch(async () => jsonResponse(200, { active: true, subject: 'x' }));
    const verifier = createMachineTokenVerifier({ baseUrl: 'http://security.local/api', fetch });

    await expect(verifier.verifyMachineToken('')).rejects.toMatchObject({ code: 'NO_TOKEN' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
