import { handleOrgCreated } from '../src/handler';
import { FuzeEvent, TOPICS, IdentityOrgCreatedPayloadV1 } from '@fuzefront/shared/kafka';
import { HttpClient } from '../src/provision';

const SECRET = 'test-secret';
const SECURITY_URL = 'http://security:3002';
const OWNER_ID = '22222222-2222-2222-2222-222222222222';
const ORG_ID = '33333333-3333-3333-3333-333333333333';

function makeEvent(
  overrides: Partial<IdentityOrgCreatedPayloadV1> = {}
): FuzeEvent<IdentityOrgCreatedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_ORG_CREATED,
    correlationId: 'corr-org-1',
    occurredAt: new Date().toISOString(),
    payload: {
      organizationId: ORG_ID,
      slug: 'acme',
      name: 'Acme Inc',
      type: 'organization',
      parentId: null,
      ownerId: OWNER_ID,
      isActive: true,
      ...overrides,
    },
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

describe('handleOrgCreated', () => {
  it('reconciles the org by calling /internal/provision with the OWNER id', async () => {
    const http = makeHttpClient([{ status: 200, body: { ok: true, personalOrgId: 'p', reconciled: true } }]);

    await handleOrgCreated(makeEvent(), deps(http));

    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].url).toBe(`${SECURITY_URL}/internal/provision`);
    expect(JSON.parse(http.calls[0].init.body as string)).toEqual({ userId: OWNER_ID });
    expect((http.calls[0].init.headers as any)['x-internal-secret']).toBe(SECRET);
  });

  it('skips (makes NO call) when the org has no owner (root/platform org)', async () => {
    const http = makeHttpClient([{ status: 200 }]);

    await handleOrgCreated(makeEvent({ ownerId: null, type: 'platform' }), deps(http));

    expect(http.calls).toHaveLength(0);
  });

  it('propagates a non-retryable provision failure so the caller can dead-letter', async () => {
    const http = makeHttpClient([{ status: 400, body: { error: 'bad' } }]);

    await expect(handleOrgCreated(makeEvent(), deps(http))).rejects.toThrow(/security-service returned 400/);
  });
});
