import { handleMembershipAdded, handleMembershipRemoved } from '../src/handler';
import {
  FuzeEvent,
  TOPICS,
  IdentityMembershipAddedPayloadV1,
  IdentityMembershipRemovedPayloadV1,
} from '@fuzefront/shared/kafka';
import { HttpClient } from '../src/provision';

const SECRET = 'test-secret';
const SECURITY_URL = 'http://security:3002';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '33333333-3333-3333-3333-333333333333';

function addedEvent(
  overrides: Partial<IdentityMembershipAddedPayloadV1> = {}
): FuzeEvent<IdentityMembershipAddedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_MEMBERSHIP_ADDED,
    correlationId: 'corr-mem-add',
    occurredAt: new Date().toISOString(),
    payload: { organizationId: ORG_ID, userId: USER_ID, role: 'member', ...overrides },
  };
}

function removedEvent(
  overrides: Partial<IdentityMembershipRemovedPayloadV1> = {}
): FuzeEvent<IdentityMembershipRemovedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_MEMBERSHIP_REMOVED,
    correlationId: 'corr-mem-rem',
    occurredAt: new Date().toISOString(),
    payload: { organizationId: ORG_ID, userId: USER_ID, role: 'admin', ...overrides },
  };
}

function makeHttpClient(
  responses: Array<{ status: number; body?: object }>
): HttpClient & { calls: any[] } {
  const calls: any[] = [];
  let idx = 0;
  return {
    calls,
    fetch: jest.fn(async (url: string, init: RequestInit) => {
      const resp = responses[idx] ?? responses[responses.length - 1];
      idx++;
      calls.push({ url, init, respondedWith: resp });
      return { status: resp.status, json: async () => resp.body ?? {} };
    }),
  };
}

const deps = (http: HttpClient) => ({
  securityServiceUrl: SECURITY_URL,
  internalProvisionSecret: SECRET,
  http,
});

const OK = { status: 200, body: { ok: true } };

describe('handleMembershipAdded', () => {
  it('POSTs the payload to /internal/membership-sync with the internal secret', async () => {
    const http = makeHttpClient([OK]);
    await handleMembershipAdded(addedEvent(), deps(http));
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].url).toBe(`${SECURITY_URL}/internal/membership-sync`);
    expect(http.calls[0].init.method).toBe('POST');
    expect((http.calls[0].init.headers as any)['x-internal-secret']).toBe(SECRET);
    expect(JSON.parse(http.calls[0].init.body as string)).toEqual({
      organizationId: ORG_ID,
      userId: USER_ID,
      role: 'member',
    });
  });

  it('retries a transient 5xx and then succeeds', async () => {
    const http = makeHttpClient([{ status: 503 }, OK]);
    await handleMembershipAdded(addedEvent(), deps(http));
    expect(http.calls).toHaveLength(2);
  });

  it('throws (signals retry/DLQ, not silent success) when security keeps returning 5xx', async () => {
    const http = makeHttpClient([{ status: 500, body: { error: 'Membership sync failed' } }]);
    await expect(handleMembershipAdded(addedEvent(), deps(http))).rejects.toThrow(
      /security-service returned 500/
    );
    expect(http.calls.length).toBeGreaterThan(1);
  }, 15000);

  it('throws on a non-retryable 4xx without retrying', async () => {
    const http = makeHttpClient([{ status: 400, body: { error: 'bad role' } }]);
    await expect(handleMembershipAdded(addedEvent(), deps(http))).rejects.toThrow(
      /security-service returned 400/
    );
    expect(http.calls).toHaveLength(1);
  });

  it('re-delivery of the same event issues identical calls (idempotent)', async () => {
    const http = makeHttpClient([OK]);
    const ev = addedEvent();
    await handleMembershipAdded(ev, deps(http));
    await handleMembershipAdded(ev, deps(http));
    expect(http.calls).toHaveLength(2);
    expect(http.calls[0].init.body).toBe(http.calls[1].init.body);
  });
});

describe('handleMembershipRemoved', () => {
  it('POSTs the payload to /internal/membership-unsync', async () => {
    const http = makeHttpClient([OK]);
    await handleMembershipRemoved(removedEvent(), deps(http));
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].url).toBe(`${SECURITY_URL}/internal/membership-unsync`);
    expect(JSON.parse(http.calls[0].init.body as string)).toEqual({
      organizationId: ORG_ID,
      userId: USER_ID,
      role: 'admin',
    });
  });

  it('throws (signals retry/DLQ) when security keeps returning 5xx', async () => {
    const http = makeHttpClient([{ status: 502 }]);
    await expect(handleMembershipRemoved(removedEvent(), deps(http))).rejects.toThrow(
      /security-service returned 502/
    );
  }, 15000);

  it('throws on a non-retryable 4xx', async () => {
    const http = makeHttpClient([{ status: 401, body: { error: 'Unauthorized' } }]);
    await expect(handleMembershipRemoved(removedEvent(), deps(http))).rejects.toThrow(
      /security-service returned 401/
    );
    expect(http.calls).toHaveLength(1);
  });
});
