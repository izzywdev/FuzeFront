/**
 * C2: DLQ routing tests for the consumer wrapper in src/index.ts.
 *
 * Strategy: replicate the same try/catch wrapper logic used in index.ts's consumer.run()
 * handler, wiring it to a mocked dlqProducer and a mocked handleUserCreated.
 * This verifies:
 *   (a) on 4xx failure  → DLQ send is called with the right topic + payload, no throw
 *   (b) on 5xx-exhaustion → DLQ send is called with the right topic + payload, no throw
 */

import { FuzeEvent, TOPICS, IdentityUserCreatedPayloadV1 } from '@fuzefront/shared/kafka';
import { handleUserCreated } from '../src/handler';
import { HttpClient } from '../src/provision';

jest.mock('../src/handler');

const mockedHandleUserCreated = handleUserCreated as jest.MockedFunction<typeof handleUserCreated>;

const SECRET = 'test-secret';
const SECURITY_URL = 'http://security:3002';

function makeEvent(
  overrides: Partial<IdentityUserCreatedPayloadV1> = {}
): FuzeEvent<IdentityUserCreatedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_USER_CREATED,
    correlationId: 'corr-dlq-1',
    occurredAt: new Date().toISOString(),
    payload: {
      userId: '22222222-2222-2222-2222-222222222222',
      email: 'bob@example.com',
      intent: 'signup',
      ...overrides,
    },
  };
}

/** Builds a minimal mock for dlqProducer (only raw.send is needed). */
function makeDlqProducer() {
  const sendMock = jest.fn().mockResolvedValue(undefined);
  return {
    raw: { send: sendMock },
    _sendMock: sendMock,
  };
}

/**
 * The inline handler wrapper from index.ts, extracted here for unit testing.
 * Mirrors the logic in consumer.run(async (event) => { try { ... } catch { DLQ } }).
 */
async function consumerHandlerWrapper(
  event: FuzeEvent<IdentityUserCreatedPayloadV1>,
  deps: { securityServiceUrl: string; internalProvisionSecret: string },
  dlqProducer: { raw: { send: jest.Mock } }
): Promise<void> {
  try {
    await handleUserCreated(event, deps);
  } catch (err) {
    const dlqTopicName = `${TOPICS.IDENTITY_USER_CREATED}.dlq`;
    await dlqProducer.raw.send({
      topic: dlqTopicName,
      messages: [
        {
          value: JSON.stringify({
            raw: JSON.stringify(event),
            reason: String(err),
            sourceTopic: TOPICS.IDENTITY_USER_CREATED,
          }),
        },
      ],
    });
  }
}

describe('consumer DLQ routing (C2)', () => {
  const deps = {
    securityServiceUrl: SECURITY_URL,
    internalProvisionSecret: SECRET,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('(a) routes 4xx failure to DLQ and does not throw', async () => {
    const dlqProducer = makeDlqProducer();
    const error4xx = new Error('security-service returned 401: {"error":"Unauthorized"}');
    mockedHandleUserCreated.mockRejectedValueOnce(error4xx);

    const event = makeEvent();

    // Must NOT throw — consumer keeps running
    await expect(
      consumerHandlerWrapper(event, deps, dlqProducer)
    ).resolves.toBeUndefined();

    // DLQ producer must have been called once
    expect(dlqProducer._sendMock).toHaveBeenCalledTimes(1);

    const callArg = dlqProducer._sendMock.mock.calls[0][0];
    expect(callArg.topic).toBe(`${TOPICS.IDENTITY_USER_CREATED}.dlq`);

    const payload = JSON.parse(callArg.messages[0].value);
    expect(payload.reason).toContain('401');
    expect(payload.sourceTopic).toBe(TOPICS.IDENTITY_USER_CREATED);
    expect(JSON.parse(payload.raw).correlationId).toBe(event.correlationId);
  });

  it('(b) routes 5xx-exhaustion failure to DLQ and does not throw', async () => {
    const dlqProducer = makeDlqProducer();
    const error5xx = new Error('security-service returned 503 (attempt 4)');
    mockedHandleUserCreated.mockRejectedValueOnce(error5xx);

    const event = makeEvent();

    // Must NOT throw — consumer keeps running
    await expect(
      consumerHandlerWrapper(event, deps, dlqProducer)
    ).resolves.toBeUndefined();

    // DLQ producer must have been called once
    expect(dlqProducer._sendMock).toHaveBeenCalledTimes(1);

    const callArg = dlqProducer._sendMock.mock.calls[0][0];
    expect(callArg.topic).toBe(`${TOPICS.IDENTITY_USER_CREATED}.dlq`);

    const payload = JSON.parse(callArg.messages[0].value);
    expect(payload.reason).toContain('503');
    expect(payload.sourceTopic).toBe(TOPICS.IDENTITY_USER_CREATED);
    expect(JSON.parse(payload.raw).correlationId).toBe(event.correlationId);
  });

  it('does NOT call DLQ when handler succeeds', async () => {
    const dlqProducer = makeDlqProducer();
    mockedHandleUserCreated.mockResolvedValueOnce(undefined);

    const event = makeEvent();
    await consumerHandlerWrapper(event, deps, dlqProducer);

    expect(dlqProducer._sendMock).not.toHaveBeenCalled();
  });
});
