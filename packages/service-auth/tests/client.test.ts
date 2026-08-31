/**
 * @fuzefront/service-auth — caller-side client tests.
 *
 * Covers: refresh happens BEFORE expiry (not reactively after a 401), and
 * concurrent `getToken()` calls during a refresh share one in-flight request
 * rather than stampeding the issuance endpoint.
 */
import { createServiceAuthClient } from '../src/client';
import { ServiceAuthError } from '../src/types';
import type { FetchLike } from '../src/types';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('createServiceAuthClient', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws MISCONFIGURED without baseUrl/clientId/clientSecret', () => {
    expect(() => createServiceAuthClient({} as any)).toThrow(ServiceAuthError);
  });

  it('fetches a token and caches it for subsequent calls', async () => {
    const fetch = jest.fn(async () => jsonResponse(200, { accessToken: 'tok-1', tokenType: 'Bearer', expiresIn: 3600 })) as unknown as FetchLike;
    const client = createServiceAuthClient({ baseUrl: 'http://security.local/api', clientId: 'c1', clientSecret: 's1', fetch });

    const t1 = await client.getToken();
    const t2 = await client.getToken();
    expect(t1).toBe('tok-1');
    expect(t2).toBe('tok-1');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes BEFORE expiry once inside the safety margin, not reactively after it', async () => {
    jest.useFakeTimers();
    let call = 0;
    const fetch = jest.fn(async () => {
      call += 1;
      return jsonResponse(200, { accessToken: `tok-${call}`, tokenType: 'Bearer', expiresIn: 100 });
    }) as unknown as FetchLike;
    const client = createServiceAuthClient({
      baseUrl: 'http://security.local/api',
      clientId: 'c1',
      clientSecret: 's1',
      fetch,
      refreshMarginSeconds: 30,
    });

    const t1 = await client.getToken();
    expect(t1).toBe('tok-1');

    // 69s elapsed of a 100s token with a 30s margin (threshold = 70s) — still fresh.
    jest.advanceTimersByTime(69_000);
    const t2 = await client.getToken();
    expect(t2).toBe('tok-1');
    expect(call).toBe(1);

    // Cross the 70s threshold — next getToken() must refresh proactively,
    // before the token has actually expired at 100s.
    jest.advanceTimersByTime(2_000);
    const t3 = await client.getToken();
    expect(t3).toBe('tok-2');
    expect(call).toBe(2);
  });

  it('single-flights concurrent getToken() calls during a refresh (no stampede)', async () => {
    let releaseFetch: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      releaseFetch = resolve;
    });
    let callCount = 0;
    const fetch = jest.fn(async () => {
      callCount += 1;
      await gate;
      return jsonResponse(200, { accessToken: 'tok-shared', tokenType: 'Bearer', expiresIn: 3600 });
    }) as unknown as FetchLike;
    const client = createServiceAuthClient({ baseUrl: 'http://security.local/api', clientId: 'c1', clientSecret: 's1', fetch });

    const p1 = client.getToken();
    const p2 = client.getToken();
    const p3 = client.getToken();
    releaseFetch();
    const [t1, t2, t3] = await Promise.all([p1, p2, p3]);

    expect(t1).toBe('tok-shared');
    expect(t2).toBe('tok-shared');
    expect(t3).toBe('tok-shared');
    expect(callCount).toBe(1); // NOT 3 — the whole point of single-flight.
  });

  it('invalidate() forces the next getToken() to fetch fresh', async () => {
    let call = 0;
    const fetch = jest.fn(async () => {
      call += 1;
      return jsonResponse(200, { accessToken: `tok-${call}`, tokenType: 'Bearer', expiresIn: 3600 });
    }) as unknown as FetchLike;
    const client = createServiceAuthClient({ baseUrl: 'http://security.local/api', clientId: 'c1', clientSecret: 's1', fetch });

    expect(await client.getToken()).toBe('tok-1');
    client.invalidate();
    expect(await client.getToken()).toBe('tok-2');
  });

  it('fails closed (throws) on a non-2xx issuance response', async () => {
    const fetch = jest.fn(async () => jsonResponse(401, { error: 'invalid client credentials' })) as unknown as FetchLike;
    const client = createServiceAuthClient({ baseUrl: 'http://security.local/api', clientId: 'bad', clientSecret: 'bad', fetch });

    await expect(client.getToken()).rejects.toMatchObject({ code: 'TOKEN_REQUEST_FAILED' });
  });

  it('fails closed on a network error contacting the issuance endpoint', async () => {
    const fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as FetchLike;
    const client = createServiceAuthClient({ baseUrl: 'http://security.local/api', clientId: 'c1', clientSecret: 's1', fetch });

    await expect(client.getToken()).rejects.toMatchObject({ code: 'TOKEN_REQUEST_FAILED' });
  });

  it('fails closed on a response missing accessToken', async () => {
    const fetch = jest.fn(async () => jsonResponse(200, { tokenType: 'Bearer', expiresIn: 3600 })) as unknown as FetchLike;
    const client = createServiceAuthClient({ baseUrl: 'http://security.local/api', clientId: 'c1', clientSecret: 's1', fetch });

    await expect(client.getToken()).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  });
});
