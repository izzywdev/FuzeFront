import {
  billingLlmUsageSchemaV1,
  notifyEmailRequestedSchemaV1,
  notifyEmailStatusSchemaV1,
  identityUserCreatedSchemaV1,
  TOPICS,
  dlqTopic,
} from '@fuzefront/shared';

describe('notifyEmailRequestedSchemaV1', () => {
  it('accepts a valid event payload', () => {
    const payload = {
      to: 'alice@example.com',
      template: 'welcome' as const,
      vars: { firstName: 'Alice' },
      orgId: 'org-123',
      correlationId: 'corr-abc',
    };
    expect(() => notifyEmailRequestedSchemaV1.parse(payload)).not.toThrow();
  });

  it('rejects missing correlationId', () => {
    const payload = { to: 'alice@example.com', template: 'welcome', vars: {} };
    expect(() => notifyEmailRequestedSchemaV1.parse(payload)).toThrow();
  });

  it('rejects invalid email address', () => {
    const payload = { to: 'not-an-email', template: 'welcome', vars: {}, correlationId: 'x' };
    expect(() => notifyEmailRequestedSchemaV1.parse(payload)).toThrow();
  });

  it('rejects unknown template name', () => {
    const payload = { to: 'a@b.com', template: 'nonexistent', vars: {}, correlationId: 'x' };
    expect(() => notifyEmailRequestedSchemaV1.parse(payload)).toThrow();
  });
});

describe('notifyEmailStatusSchemaV1', () => {
  it('accepts a valid status event', () => {
    const payload = {
      correlationId: 'corr-abc',
      to: 'alice@example.com',
      template: 'welcome',
      status: 'sent' as const,
      attemptedAt: new Date().toISOString(),
    };
    expect(() => notifyEmailStatusSchemaV1.parse(payload)).not.toThrow();
  });

  it('rejects invalid status', () => {
    const payload = {
      correlationId: 'x',
      to: 'a@b.com',
      template: 'welcome',
      status: 'bounced',
      attemptedAt: new Date().toISOString(),
    };
    expect(() => notifyEmailStatusSchemaV1.parse(payload)).toThrow();
  });
});

describe('identityUserCreatedSchemaV1', () => {
  it('accepts a valid user-created payload', () => {
    const payload = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'alice@example.com',
      firstName: 'Alice',
      intent: 'signup' as const,
    };
    expect(() => identityUserCreatedSchemaV1.parse(payload)).not.toThrow();
  });

  it('rejects non-UUID userId', () => {
    const payload = { userId: 'not-a-uuid', email: 'a@b.com', intent: 'signup' };
    expect(() => identityUserCreatedSchemaV1.parse(payload)).toThrow();
  });
});

describe('billingLlmUsageSchemaV1', () => {
  const validPayload = {
    userId: '550e8400-e29b-41d4-a716-446655440000',
    orgId: '660e8400-e29b-41d4-a716-446655440001',
    model: 'claude-3-5-sonnet',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    conversationId: '770e8400-e29b-41d4-a716-446655440002',
    timestamp: '2024-01-15T12:00:00.000Z',
  };

  it('accepts a valid payload', () => {
    expect(() => billingLlmUsageSchemaV1.parse(validPayload)).not.toThrow();
  });

  it('rejects negative token count', () => {
    const payload = { ...validPayload, promptTokens: -1 };
    expect(() => billingLlmUsageSchemaV1.parse(payload)).toThrow();
  });

  it('rejects a bad userId (not a UUID)', () => {
    const payload = { ...validPayload, userId: 'not-a-uuid' };
    expect(() => billingLlmUsageSchemaV1.parse(payload)).toThrow();
  });

  it('rejects a missing required field', () => {
    const { model: _omitted, ...payload } = validPayload;
    expect(() => billingLlmUsageSchemaV1.parse(payload)).toThrow();
  });

  it('rejects an invalid timestamp', () => {
    const payload = { ...validPayload, timestamp: 'not-a-date' };
    expect(() => billingLlmUsageSchemaV1.parse(payload)).toThrow();
  });
});

describe('TOPICS and dlqTopic', () => {
  it('has the four required topics', () => {
    expect(TOPICS.BILLING_LLM_USAGE).toBe('billing.llm.usage');
    expect(TOPICS.IDENTITY_USER_CREATED).toBe('identity.user.created');
    expect(TOPICS.NOTIFY_EMAIL_REQUESTED).toBe('notify.email.requested');
    expect(TOPICS.NOTIFY_EMAIL_STATUS).toBe('notify.email.status');
  });

  it('appends .dlq', () => {
    expect(dlqTopic('notify.email.requested')).toBe('notify.email.requested.dlq');
  });
});
