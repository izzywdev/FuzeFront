import { handleUserCreated } from '../src/handler';
import { FuzeEvent, TOPICS, IdentityUserCreatedPayloadV1 } from '@fuzefront/shared/kafka';
import { HttpClient } from '../src/provision';

const SECRET = 'test-secret';
const SECURITY_URL = 'http://security:3002';

function makeEvent(
  overrides: Partial<IdentityUserCreatedPayloadV1> = {}
): FuzeEvent<IdentityUserCreatedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_USER_CREATED,
    correlationId: 'corr-test-1',
    occurredAt: new Date().toISOString(),
    payload: {
      userId: '11111111-1111-1111-1111-111111111111',
      email: 'alice@example.com',
      intent: 'signup',
      ...overrides,
    },
  };
}

function makeHttpClient(responses: Array<{ status: number; body?: object }>): HttpClient & { calls: any[] } {
  const calls: any[] = [];
  let idx = 0;
  return {
    calls,
    fetch: jest.fn(async (url: string, init: RequestInit) => {
      const resp = responses[idx] ?? responses[responses.length - 1];
      idx++;
      calls.push({ url, init, respondedWith: resp });
      return {
        status: resp.status,
        json: async () => resp.body ?? {},
      };
    }),
  };
}

describe('handleUserCreated', () => {
  it('calls POST /internal/provision with correct headers and body on success', async () => {
    const http = makeHttpClient([
      { status: 200, body: { ok: true, personalOrgId: 'org-1', reconciled: false } },
    ]);

    await handleUserCreated(makeEvent(), {
      securityServiceUrl: SECURITY_URL,
      internalProvisionSecret: SECRET,
      http,
    });

    expect(http.calls).toHaveLength(1);
    const call = http.calls[0];
    expect(call.url).toBe(`${SECURITY_URL}/internal/provision`);
    expect(call.init.method).toBe('POST');

    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-internal-secret']).toBe(SECRET);
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(call.init.body as string);
    expect(body.userId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('does NOT call provision twice on success', async () => {
    const http = makeHttpClient([
      { status: 200, body: { ok: true, personalOrgId: 'org-1', reconciled: false } },
    ]);

    await handleUserCreated(makeEvent(), {
      securityServiceUrl: SECURITY_URL,
      internalProvisionSecret: SECRET,
      http,
    });

    expect(http.calls).toHaveLength(1);
  });

  it('retries on 5xx up to RETRY_COUNT times then throws', async () => {
    // All responses are 500 — exhausts retries (1 initial + 3 retries = 4 calls)
    const http = makeHttpClient([
      { status: 500 },
      { status: 500 },
      { status: 500 },
      { status: 500 },
    ]);

    await expect(
      handleUserCreated(makeEvent(), {
        securityServiceUrl: SECURITY_URL,
        internalProvisionSecret: SECRET,
        http,
      })
    ).rejects.toThrow();

    // 1 initial attempt + 3 retries = 4 total
    expect(http.calls).toHaveLength(4);
  });

  it('succeeds on the final retry after initial 5xx failures', async () => {
    // Two 500s then success
    const http = makeHttpClient([
      { status: 500 },
      { status: 500 },
      { status: 200, body: { ok: true, personalOrgId: 'org-2', reconciled: true } },
    ]);

    await handleUserCreated(makeEvent(), {
      securityServiceUrl: SECURITY_URL,
      internalProvisionSecret: SECRET,
      http,
    });

    expect(http.calls).toHaveLength(3);
  });

  it('does NOT retry on 4xx — throws immediately', async () => {
    const http = makeHttpClient([
      { status: 401, body: { error: 'Unauthorized' } },
    ]);

    await expect(
      handleUserCreated(makeEvent(), {
        securityServiceUrl: SECURITY_URL,
        internalProvisionSecret: SECRET,
        http,
      })
    ).rejects.toThrow(/401/);

    // Only one attempt — no retries for 4xx
    expect(http.calls).toHaveLength(1);
  });
});
