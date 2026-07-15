import { handlePaymentCompleted } from '../../src/handlers/payment-completed';

const ORG_ID = '33333333-3333-4333-8333-333333333333';
const OCCURRED_UNIX = 1_752_000_000;
const OCCURRED_ISO = new Date(OCCURRED_UNIX * 1000).toISOString();

function mirrorRow(overrides: any = {}) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    sessionId: 'cs_pay_1',
    paymentIntentId: null,
    productKey: 'mendys-datasets',
    externalOrderId: 'order-42',
    entityType: 'organization',
    entityId: ORG_ID,
    amountTotalCents: 85000,
    currency: 'usd',
    status: 'pending',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCtx(overrides: any = {}) {
  return {
    customers: {
      findByStripeCustomerId: jest.fn().mockResolvedValue({
        id: 'localcust_1',
        entityType: 'organization',
        entityId: ORG_ID,
        stripeCustomerId: 'cus_1',
      }),
    },
    subscriptions: { upsert: jest.fn() },
    plans: { findByPriceId: jest.fn() },
    payments: {
      // Echo the upsert back as the resulting row (repository behaviour for a
      // non-conflicting write).
      upsert: jest.fn().mockImplementation(async (row: any) => ({ ...mirrorRow(), ...row })),
      getBySessionId: jest.fn().mockResolvedValue(mirrorRow()),
      findByOrder: jest.fn().mockResolvedValue(mirrorRow()),
    },
    permit: { syncPlanToPermit: jest.fn() },
    emitter: {
      subscriptionChanged: jest.fn(),
      paymentCompleted: jest.fn().mockResolvedValue(undefined),
    },
    writePlanCache: jest.fn(),
    ...overrides,
  } as any;
}

function sessionEvent(type: string, overrides: any = {}) {
  return {
    id: 'evt_pay_1',
    type,
    created: OCCURRED_UNIX,
    data: {
      object: {
        id: 'cs_pay_1',
        mode: 'payment',
        status: 'complete',
        payment_status: 'paid',
        customer: 'cus_1',
        payment_intent: 'pi_1',
        amount_total: 85000,
        currency: 'usd',
        client_reference_id: 'order-42',
        metadata: { productKey: 'mendys-datasets', externalOrderId: 'order-42' },
        ...overrides,
      },
    },
  } as any;
}

function intentFailedEvent(overrides: any = {}) {
  return {
    id: 'evt_pi_1',
    type: 'payment_intent.payment_failed',
    created: OCCURRED_UNIX,
    data: {
      object: {
        id: 'pi_1',
        object: 'payment_intent',
        metadata: { productKey: 'mendys-datasets', externalOrderId: 'order-42' },
        ...overrides,
      },
    },
  } as any;
}

describe('handlePaymentCompleted — checkout.session.completed (payment mode)', () => {
  it('upserts the mirror as paid and emits billing.payment.completed', async () => {
    const ctx = makeCtx();
    await handlePaymentCompleted(sessionEvent('checkout.session.completed'), ctx);

    expect(ctx.payments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'cs_pay_1',
        paymentIntentId: 'pi_1',
        productKey: 'mendys-datasets',
        externalOrderId: 'order-42',
        entityType: 'organization',
        entityId: ORG_ID,
        amountTotalCents: 85000,
        currency: 'usd',
        status: 'paid',
      }),
    );
    expect(ctx.emitter.paymentCompleted).toHaveBeenCalledTimes(1);
    expect(ctx.emitter.paymentCompleted).toHaveBeenCalledWith({
      productKey: 'mendys-datasets',
      externalOrderId: 'order-42',
      entityType: 'organization',
      entityId: ORG_ID,
      stripeSessionId: 'cs_pay_1',
      stripePaymentIntentId: 'pi_1',
      amountTotalCents: 85000,
      currency: 'usd',
      status: 'paid',
      occurredAt: OCCURRED_ISO,
    });
  });

  it('resolves the entity via the Stripe customer when no mirror row exists', async () => {
    const ctx = makeCtx();
    ctx.payments.getBySessionId.mockResolvedValue(null);
    await handlePaymentCompleted(sessionEvent('checkout.session.completed'), ctx);

    expect(ctx.customers.findByStripeCustomerId).toHaveBeenCalledWith('cus_1');
    expect(ctx.payments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'organization', entityId: ORG_ID, status: 'paid' }),
    );
    expect(ctx.emitter.paymentCompleted).toHaveBeenCalledTimes(1);
  });

  it('mirrors a completed-but-unpaid session as pending WITHOUT emitting', async () => {
    const ctx = makeCtx();
    await handlePaymentCompleted(
      sessionEvent('checkout.session.completed', { payment_status: 'unpaid' }),
      ctx,
    );
    expect(ctx.payments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
    expect(ctx.emitter.paymentCompleted).not.toHaveBeenCalled();
  });

  it('ignores subscription-mode sessions', async () => {
    const ctx = makeCtx();
    await handlePaymentCompleted(
      sessionEvent('checkout.session.completed', { mode: 'subscription' }),
      ctx,
    );
    expect(ctx.payments.upsert).not.toHaveBeenCalled();
    expect(ctx.emitter.paymentCompleted).not.toHaveBeenCalled();
  });

  it('skips sessions without our product metadata (foreign integration)', async () => {
    const ctx = makeCtx();
    await handlePaymentCompleted(
      sessionEvent('checkout.session.completed', { metadata: {}, client_reference_id: null }),
      ctx,
    );
    expect(ctx.payments.upsert).not.toHaveBeenCalled();
    expect(ctx.emitter.paymentCompleted).not.toHaveBeenCalled();
  });

  it('skips when no local entity can be resolved (no row, unknown customer)', async () => {
    const ctx = makeCtx();
    ctx.payments.getBySessionId.mockResolvedValue(null);
    ctx.customers.findByStripeCustomerId.mockResolvedValue(null);
    await handlePaymentCompleted(sessionEvent('checkout.session.completed'), ctx);
    expect(ctx.payments.upsert).not.toHaveBeenCalled();
    expect(ctx.emitter.paymentCompleted).not.toHaveBeenCalled();
  });
});

describe('handlePaymentCompleted — checkout.session.expired', () => {
  it('upserts the mirror as expired and emits status=expired', async () => {
    const ctx = makeCtx();
    await handlePaymentCompleted(
      sessionEvent('checkout.session.expired', {
        status: 'expired',
        payment_status: 'unpaid',
        payment_intent: null,
      }),
      ctx,
    );

    expect(ctx.payments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'cs_pay_1', status: 'expired' }),
    );
    expect(ctx.emitter.paymentCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'expired',
        stripeSessionId: 'cs_pay_1',
        occurredAt: OCCURRED_ISO,
      }),
    );
  });
});

describe('handlePaymentCompleted — payment_intent.payment_failed', () => {
  it('marks the mirror failed (correlated via product metadata) and emits status=failed', async () => {
    const ctx = makeCtx();
    await handlePaymentCompleted(intentFailedEvent(), ctx);

    expect(ctx.payments.findByOrder).toHaveBeenCalledWith('mendys-datasets', 'order-42');
    expect(ctx.payments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'cs_pay_1',
        paymentIntentId: 'pi_1',
        status: 'failed',
      }),
    );
    expect(ctx.emitter.paymentCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        productKey: 'mendys-datasets',
        externalOrderId: 'order-42',
        stripeSessionId: 'cs_pay_1',
        stripePaymentIntentId: 'pi_1',
        status: 'failed',
        occurredAt: OCCURRED_ISO,
      }),
    );
  });

  it('ignores PaymentIntents without product metadata (subscription invoices)', async () => {
    const ctx = makeCtx();
    await handlePaymentCompleted(intentFailedEvent({ metadata: {} }), ctx);
    expect(ctx.payments.findByOrder).not.toHaveBeenCalled();
    expect(ctx.payments.upsert).not.toHaveBeenCalled();
    expect(ctx.emitter.paymentCompleted).not.toHaveBeenCalled();
  });

  it('skips when no mirror row matches the order (nothing to correlate)', async () => {
    const ctx = makeCtx();
    ctx.payments.findByOrder.mockResolvedValue(null);
    await handlePaymentCompleted(intentFailedEvent(), ctx);
    expect(ctx.payments.upsert).not.toHaveBeenCalled();
    expect(ctx.emitter.paymentCompleted).not.toHaveBeenCalled();
  });

  it('does NOT emit a stale failed when the repository kept the row paid (race)', async () => {
    const ctx = makeCtx();
    // Repository's 'paid'-is-terminal rule: the upsert returns the paid row.
    ctx.payments.upsert.mockResolvedValue(mirrorRow({ status: 'paid' }));
    await handlePaymentCompleted(intentFailedEvent(), ctx);
    expect(ctx.emitter.paymentCompleted).not.toHaveBeenCalled();
  });
});
