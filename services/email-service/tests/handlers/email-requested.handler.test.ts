import { handleEmailRequested, HandlerDeps } from '../../src/handlers/email-requested.handler';
import { FuzeEvent, TOPICS, NotifyEmailRequestedPayloadV1 } from '@fuzefront/shared';

function makeEvent(overrides: Partial<NotifyEmailRequestedPayloadV1> = {}): FuzeEvent<NotifyEmailRequestedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.NOTIFY_EMAIL_REQUESTED,
    correlationId: 'corr-test-1',
    occurredAt: new Date().toISOString(),
    payload: {
      to: 'alice@example.com',
      template: 'welcome',
      vars: { firstName: 'Alice' },
      correlationId: 'corr-test-1',
      ...overrides,
    },
  };
}

function makeDeps(): HandlerDeps & { sentMessages: any[]; producedEvents: any[] } {
  const sentMessages: any[] = [];
  const producedEvents: any[] = [];
  return {
    sentMessages,
    producedEvents,
    provider: {
      send: jest.fn(async (msg) => {
        sentMessages.push(msg);
        return { messageId: 'msg-id-1' };
      }),
    },
    statusProducer: {
      send: jest.fn(async (_topic: any, event: any) => {
        producedEvents.push(event);
      }),
    } as any,
    from: 'noreply@fuzefront.com',
  };
}

describe('handleEmailRequested', () => {
  it('renders template and calls provider.send', async () => {
    const deps = makeDeps();
    await handleEmailRequested(makeEvent(), deps);
    expect(deps.provider.send).toHaveBeenCalledTimes(1);
    const msg = deps.sentMessages[0];
    expect(msg.to).toBe('alice@example.com');
    expect(msg.html).toContain('Alice');
  });

  it('emits notify.email.status with status=sent on success', async () => {
    const deps = makeDeps();
    await handleEmailRequested(makeEvent(), deps);
    expect(deps.statusProducer.send).toHaveBeenCalledTimes(1);
    const event = deps.producedEvents[0];
    expect(event.payload.status).toBe('sent');
    expect(event.payload.correlationId).toBe('corr-test-1');
  });

  it('emits status=failed when provider throws', async () => {
    const deps = makeDeps();
    (deps.provider.send as jest.Mock).mockRejectedValueOnce(new Error('SMTP timeout'));
    await handleEmailRequested(makeEvent(), deps);
    expect(deps.statusProducer.send).toHaveBeenCalledTimes(1);
    const event = deps.producedEvents[0];
    expect(event.payload.status).toBe('failed');
    // error field must be a stable code — NOT the raw provider message
    expect(event.payload.error).toBe('provider_timeout');
    expect(event.payload.error).not.toContain('SMTP');
  });
});
