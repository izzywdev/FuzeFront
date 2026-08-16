import { handleOrgUpdated, handleOrgDeleted } from '../src/handler';
import {
  FuzeEvent,
  TOPICS,
  IdentityOrgUpdatedPayloadV1,
  IdentityOrgDeletedPayloadV1,
} from '@fuzefront/shared/kafka';
import { HttpClient } from '../src/provision';

const SECRET = 'test-secret';
const SECURITY_URL = 'http://security:3002';
const OWNER_ID = '22222222-2222-2222-2222-222222222222';
const ORG_ID = '33333333-3333-3333-3333-333333333333';

function updatedEvent(
  overrides: Partial<IdentityOrgUpdatedPayloadV1> = {}
): FuzeEvent<IdentityOrgUpdatedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_ORG_UPDATED,
    correlationId: 'corr-org-upd',
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

function deletedEvent(
  overrides: Partial<IdentityOrgDeletedPayloadV1> = {}
): FuzeEvent<IdentityOrgDeletedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_ORG_DELETED,
    correlationId: 'corr-org-del',
    occurredAt: new Date().toISOString(),
    payload: {
      organizationId: ORG_ID,
      slug: 'acme',
      ownerId: OWNER_ID,
      cascade: 'soft',
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

describe('handleOrgUpdated', () => {
  it('re-reconciles via /internal/provision with the owner id', async () => {
    const http = makeHttpClient([{ status: 200, body: { ok: true, personalOrgId: null, reconciled: true } }]);
    await handleOrgUpdated(updatedEvent(), deps(http));
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].url).toBe(`${SECURITY_URL}/internal/provision`);
    expect(JSON.parse(http.calls[0].init.body as string)).toEqual({ userId: OWNER_ID });
  });

  it('skips when the org has no owner', async () => {
    const http = makeHttpClient([{ status: 200 }]);
    await handleOrgUpdated(updatedEvent({ ownerId: null, type: 'platform' }), deps(http));
    expect(http.calls).toHaveLength(0);
  });
});

describe('handleOrgDeleted', () => {
  it('calls /internal/deprovision with organizationId + cascade', async () => {
    const http = makeHttpClient([
      { status: 200, body: { ok: true, organizationId: ORG_ID, cascade: 'soft', rolesRevoked: 2, tenantDeleted: false } },
    ]);
    await handleOrgDeleted(deletedEvent(), deps(http));
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].url).toBe(`${SECURITY_URL}/internal/deprovision`);
    expect(JSON.parse(http.calls[0].init.body as string)).toEqual({
      organizationId: ORG_ID,
      cascade: 'soft',
    });
  });

  it('forwards a hard cascade', async () => {
    const http = makeHttpClient([
      { status: 200, body: { ok: true, organizationId: ORG_ID, cascade: 'hard', rolesRevoked: 0, tenantDeleted: true } },
    ]);
    await handleOrgDeleted(deletedEvent({ cascade: 'hard' }), deps(http));
    expect(JSON.parse(http.calls[0].init.body as string)).toEqual({
      organizationId: ORG_ID,
      cascade: 'hard',
    });
  });

  it('propagates a non-retryable failure so the caller can dead-letter', async () => {
    const http = makeHttpClient([{ status: 400, body: { error: 'bad' } }]);
    await expect(handleOrgDeleted(deletedEvent(), deps(http))).rejects.toThrow(/security-service returned 400/);
  });
});
