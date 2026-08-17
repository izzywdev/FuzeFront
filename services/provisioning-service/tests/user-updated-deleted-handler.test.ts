import { handleUserUpdated, handleUserDeleted } from '../src/handler';
import {
  FuzeEvent,
  TOPICS,
  IdentityUserUpdatedPayloadV1,
  IdentityUserDeletedPayloadV1,
} from '@fuzefront/shared/kafka';
import { HttpClient } from '../src/provision';

const SECRET = 'test-secret';
const SECURITY_URL = 'http://security:3002';
const USER_ID = '11111111-1111-1111-1111-111111111111';

function updatedEvent(
  overrides: Partial<IdentityUserUpdatedPayloadV1> = {}
): FuzeEvent<IdentityUserUpdatedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_USER_UPDATED,
    correlationId: 'corr-user-upd',
    occurredAt: new Date().toISOString(),
    payload: {
      userId: USER_ID,
      email: 'user@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      ...overrides,
    },
  };
}

function deletedEvent(
  overrides: Partial<IdentityUserDeletedPayloadV1> = {}
): FuzeEvent<IdentityUserDeletedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_USER_DELETED,
    correlationId: 'corr-user-del',
    occurredAt: new Date().toISOString(),
    payload: {
      userId: USER_ID,
      email: 'user@example.com',
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

describe('handleUserUpdated', () => {
  it('posts the profile to /internal/user-sync', async () => {
    const http = makeHttpClient([
      { status: 200, body: { ok: true, userId: USER_ID, permitSynced: true } },
    ]);
    await handleUserUpdated(updatedEvent(), deps(http));
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].url).toBe(`${SECURITY_URL}/internal/user-sync`);
    expect(JSON.parse(http.calls[0].init.body as string)).toEqual({
      userId: USER_ID,
      email: 'user@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
  });

  it('omits absent optional name fields', async () => {
    const http = makeHttpClient([
      { status: 200, body: { ok: true, userId: USER_ID, permitSynced: true } },
    ]);
    await handleUserUpdated(
      updatedEvent({ firstName: undefined, lastName: undefined }),
      deps(http)
    );
    expect(JSON.parse(http.calls[0].init.body as string)).toEqual({
      userId: USER_ID,
      email: 'user@example.com',
    });
  });

  it('propagates a non-retryable failure so the caller can dead-letter', async () => {
    const http = makeHttpClient([{ status: 400, body: { error: 'bad' } }]);
    await expect(handleUserUpdated(updatedEvent(), deps(http))).rejects.toThrow(
      /security-service returned 400/
    );
  });
});

describe('handleUserDeleted', () => {
  it('calls /internal/user-delete with userId + cascade', async () => {
    const http = makeHttpClient([
      {
        status: 200,
        body: {
          ok: true,
          userId: USER_ID,
          cascade: 'soft',
          permitDeleted: true,
          sessionsRevoked: 3,
        },
      },
    ]);
    await handleUserDeleted(deletedEvent(), deps(http));
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].url).toBe(`${SECURITY_URL}/internal/user-delete`);
    expect(JSON.parse(http.calls[0].init.body as string)).toEqual({
      userId: USER_ID,
      cascade: 'soft',
    });
  });

  it('forwards a hard cascade', async () => {
    const http = makeHttpClient([
      {
        status: 200,
        body: {
          ok: true,
          userId: USER_ID,
          cascade: 'hard',
          permitDeleted: true,
          sessionsRevoked: 0,
        },
      },
    ]);
    await handleUserDeleted(deletedEvent({ cascade: 'hard' }), deps(http));
    expect(JSON.parse(http.calls[0].init.body as string)).toEqual({
      userId: USER_ID,
      cascade: 'hard',
    });
  });

  it('propagates a non-retryable failure so the caller can dead-letter', async () => {
    const http = makeHttpClient([{ status: 400, body: { error: 'bad' } }]);
    await expect(handleUserDeleted(deletedEvent(), deps(http))).rejects.toThrow(
      /security-service returned 400/
    );
  });
});
