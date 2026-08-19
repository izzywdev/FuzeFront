import {
  billingUsageRecordedSchemaV1,
  billingSubscriptionChangedSchemaV1,
  billingTenantRegisteredSchemaV1,
  billingPaymentMethodUpdatedSchemaV1,
  TOPICS,
} from '../../src/kafka';

// ── billingUsageRecordedSchemaV1 ─────────────────────────────────────────────

describe('billingUsageRecordedSchemaV1', () => {
  const valid = {
    entityId: '550e8400-e29b-41d4-a716-446655440000',
    entityType: 'organization' as const,
    meterEventName: 'api_calls',
    quantity: 10,
    occurredAt: '2024-01-15T12:00:00.000Z',
  };

  it('accepts a valid usage-recorded payload', () => {
    expect(() => billingUsageRecordedSchemaV1.parse(valid)).not.toThrow();
  });

  it('rejects a non-UUID entityId', () => {
    expect(() =>
      billingUsageRecordedSchemaV1.parse({ ...valid, entityId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('rejects an invalid entityType', () => {
    expect(() =>
      billingUsageRecordedSchemaV1.parse({ ...valid, entityType: 'team' }),
    ).toThrow();
  });

  it('rejects zero quantity', () => {
    expect(() =>
      billingUsageRecordedSchemaV1.parse({ ...valid, quantity: 0 }),
    ).toThrow();
  });

  it('rejects negative quantity', () => {
    expect(() =>
      billingUsageRecordedSchemaV1.parse({ ...valid, quantity: -5 }),
    ).toThrow();
  });

  it('rejects a non-integer quantity', () => {
    expect(() =>
      billingUsageRecordedSchemaV1.parse({ ...valid, quantity: 1.5 }),
    ).toThrow();
  });

  it('rejects a malformed occurredAt', () => {
    expect(() =>
      billingUsageRecordedSchemaV1.parse({ ...valid, occurredAt: '2024-13-45' }),
    ).toThrow();
  });

  it('does NOT include correlationId in the payload schema', () => {
    // correlationId lives on the FuzeEvent envelope — must not be required here
    const withoutCorrelationId = { ...valid };
    expect(() => billingUsageRecordedSchemaV1.parse(withoutCorrelationId)).not.toThrow();
  });
});

// ── billingSubscriptionChangedSchemaV1 ───────────────────────────────────────

describe('billingSubscriptionChangedSchemaV1', () => {
  const valid = {
    entityId: '550e8400-e29b-41d4-a716-446655440001',
    entityType: 'organization' as const,
    planTier: 'pro',
    status: 'active',
    stripeSubscriptionId: 'sub_1ABC',
  };

  it('accepts a valid subscription-changed payload without optional seatQuantity', () => {
    expect(() => billingSubscriptionChangedSchemaV1.parse(valid)).not.toThrow();
  });

  it('accepts a payload with optional seatQuantity', () => {
    expect(() =>
      billingSubscriptionChangedSchemaV1.parse({ ...valid, seatQuantity: 5 }),
    ).not.toThrow();
  });

  it('rejects a non-UUID entityId', () => {
    expect(() =>
      billingSubscriptionChangedSchemaV1.parse({ ...valid, entityId: 'bad-id' }),
    ).toThrow();
  });

  it('rejects an invalid entityType', () => {
    expect(() =>
      billingSubscriptionChangedSchemaV1.parse({ ...valid, entityType: 'group' }),
    ).toThrow();
  });

  it('rejects a non-integer seatQuantity', () => {
    expect(() =>
      billingSubscriptionChangedSchemaV1.parse({ ...valid, seatQuantity: 2.7 }),
    ).toThrow();
  });

  it('rejects missing stripeSubscriptionId', () => {
    const { stripeSubscriptionId: _omit, ...rest } = valid;
    expect(() => billingSubscriptionChangedSchemaV1.parse(rest)).toThrow();
  });
});

// ── billingTenantRegisteredSchemaV1 ──────────────────────────────────────────

describe('billingTenantRegisteredSchemaV1', () => {
  const valid = {
    entityId: '550e8400-e29b-41d4-a716-446655440002',
    entityType: 'organization' as const,
    stripeCustomerId: 'cus_1ABC',
  };

  it('accepts a valid tenant-registered payload', () => {
    expect(() => billingTenantRegisteredSchemaV1.parse(valid)).not.toThrow();
  });

  it('rejects a non-UUID entityId', () => {
    expect(() =>
      billingTenantRegisteredSchemaV1.parse({ ...valid, entityId: 'bad-id' }),
    ).toThrow();
  });

  it('rejects entityType "user" — tenants are always organizations', () => {
    expect(() =>
      billingTenantRegisteredSchemaV1.parse({ ...valid, entityType: 'user' }),
    ).toThrow();
  });

  it('rejects missing stripeCustomerId', () => {
    const { stripeCustomerId: _omit, ...rest } = valid;
    expect(() => billingTenantRegisteredSchemaV1.parse(rest)).toThrow();
  });
});

// ── billingPaymentMethodUpdatedSchemaV1 ──────────────────────────────────────

describe('billingPaymentMethodUpdatedSchemaV1', () => {
  const valid = {
    entityId: '550e8400-e29b-41d4-a716-446655440003',
    entityType: 'organization' as const,
    stripeCustomerId: 'cus_1ABC',
    paymentMethodId: 'pm_1ABC',
  };

  it('accepts a valid payload without optional brand/last4', () => {
    expect(() => billingPaymentMethodUpdatedSchemaV1.parse(valid)).not.toThrow();
  });

  it('accepts a payload with brand and last4', () => {
    expect(() =>
      billingPaymentMethodUpdatedSchemaV1.parse({ ...valid, brand: 'visa', last4: '4242' }),
    ).not.toThrow();
  });

  it('accepts entityType "user"', () => {
    expect(() =>
      billingPaymentMethodUpdatedSchemaV1.parse({ ...valid, entityType: 'user' }),
    ).not.toThrow();
  });

  it('rejects an invalid entityType', () => {
    expect(() =>
      billingPaymentMethodUpdatedSchemaV1.parse({ ...valid, entityType: 'team' }),
    ).toThrow();
  });

  it('rejects missing paymentMethodId', () => {
    const { paymentMethodId: _omit, ...rest } = valid;
    expect(() => billingPaymentMethodUpdatedSchemaV1.parse(rest)).toThrow();
  });
});

// ── TOPICS ───────────────────────────────────────────────────────────────────

describe('TOPICS billing constants', () => {
  it('exposes BILLING_USAGE_RECORDED', () => {
    expect(TOPICS.BILLING_USAGE_RECORDED).toBe('billing.usage.recorded');
  });

  it('exposes BILLING_SUBSCRIPTION_CHANGED', () => {
    expect(TOPICS.BILLING_SUBSCRIPTION_CHANGED).toBe('billing.subscription.changed');
  });

  it('exposes BILLING_TRIAL_ENDING', () => {
    expect(TOPICS.BILLING_TRIAL_ENDING).toBe('billing.trial.ending');
  });

  it('exposes BILLING_PAYMENT_FAILED', () => {
    expect(TOPICS.BILLING_PAYMENT_FAILED).toBe('billing.payment.failed');
  });

  it('exposes BILLING_TENANT_REGISTERED', () => {
    expect(TOPICS.BILLING_TENANT_REGISTERED).toBe('billing.tenant.registered');
  });

  it('exposes BILLING_PAYMENT_METHOD_UPDATED', () => {
    expect(TOPICS.BILLING_PAYMENT_METHOD_UPDATED).toBe('billing.payment_method.updated');
  });
});
