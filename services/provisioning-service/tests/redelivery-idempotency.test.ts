import {
  handleOrgCreated,
  handleOrgDeleted,
  handleUserUpdated,
} from '../src/handler';
import {
  FuzeEvent,
  TOPICS,
  IdentityOrgCreatedPayloadV1,
  IdentityOrgDeletedPayloadV1,
  IdentityUserUpdatedPayloadV1,
} from '@fuzefront/shared/kafka';
import { HttpClient } from '../src/provision';

/**
 * Redelivery / idempotency contract (FFRNT-175).
 *
 * Kafka + the transactional outbox are AT-LEAST-ONCE: the same event can be
 * delivered to a consumer more than once (relay retry, consumer rebalance,
 * offset-commit gap). The provisioning-service handlers must therefore be safe
 * to re-run — they carry NO per-delivery state and delegate durability to the
 * downstream `/internal/*` endpoints, which are idempotent by design (reconcile,
 * not create). These tests pin that property: re-delivering the SAME event
 * (identical correlationId) N times issues N identical downstream calls and
 * never throws or mutates behaviour between deliveries.
 */

const SECRET = 'test-secret';
const SECURITY_URL = 'http://security:3002';
const OWNER_ID = '22222222-2222-2222-2222-222222222222';
const ORG_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '11111111-1111-1111-1111-111111111111';

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

/** Assert every captured call targeted the same url with an identical body. */
function expectAllCallsIdentical(calls: any[]): void {
  const first = calls[0];
  for (const call of calls) {
    expect(call.url).toBe(first.url);
    expect(call.init.method).toBe(first.init.method);
    expect(JSON.parse(call.init.body as string)).toEqual(
      JSON.parse(first.init.body as string)
    );
  }
}

function orgDeletedEvent(): FuzeEvent<IdentityOrgDeletedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_ORG_DELETED,
    correlationId: 'corr-redeliver-org-del',
    occurredAt: new Date().toISOString(),
    payload: { organizationId: ORG_ID, slug: 'acme', ownerId: OWNER_ID, cascade: 'soft' },
  };
}

function orgCreatedEvent(
  overrides: Partial<IdentityOrgCreatedPayloadV1> = {}
): FuzeEvent<IdentityOrgCreatedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_ORG_CREATED,
    correlationId: 'corr-redeliver-org-cre',
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

function userUpdatedEvent(): FuzeEvent<IdentityUserUpdatedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_USER_UPDATED,
    correlationId: 'corr-redeliver-user-upd',
    occurredAt: new Date().toISOString(),
    payload: { userId: USER_ID, email: 'alice@example.com', firstName: 'Alice', lastName: 'Smith' },
  };
}

describe('redelivery is idempotent (at-least-once safe)', () => {
  it('handleOrgDeleted re-delivered 3× issues 3 identical /internal/deprovision calls, never throws', async () => {
    const ok = { status: 200, body: { ok: true, organizationId: ORG_ID, cascade: 'soft', rolesRevoked: 1, tenantDeleted: false } };
    const http = makeHttpClient([ok, ok, ok]);

    // Same event object, delivered three times (as a redelivery would).
    const event = orgDeletedEvent();
    for (let i = 0; i < 3; i++) {
      await expect(handleOrgDeleted(event, deps(http))).resolves.toBeUndefined();
    }

    expect(http.calls).toHaveLength(3);
    expect(http.calls[0].url).toBe(`${SECURITY_URL}/internal/deprovision`);
    expectAllCallsIdentical(http.calls);
    // The handler carries no cross-delivery state: each body is exactly the payload.
    expect(JSON.parse(http.calls[0].init.body as string)).toEqual({
      organizationId: ORG_ID,
      cascade: 'soft',
    });
  });

  it('handleUserUpdated re-delivered 2× issues 2 identical /internal/user-sync calls', async () => {
    const ok = { status: 200, body: { ok: true, permitSynced: true } };
    const http = makeHttpClient([ok, ok]);

    const event = userUpdatedEvent();
    await handleUserUpdated(event, deps(http));
    await handleUserUpdated(event, deps(http));

    expect(http.calls).toHaveLength(2);
    expectAllCallsIdentical(http.calls);
  });

  it('handleOrgCreated redelivery of an ownerless (root/platform) org stays a stable no-op', async () => {
    const http = makeHttpClient([{ status: 200 }]);

    const event = orgCreatedEvent({ ownerId: null, type: 'platform' });
    await handleOrgCreated(event, deps(http));
    await handleOrgCreated(event, deps(http));

    // Skipping is deterministic — no downstream call on any delivery.
    expect(http.calls).toHaveLength(0);
  });
});
