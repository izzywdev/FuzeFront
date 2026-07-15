/**
 * Webhook-router dispatch tests: checkout.session.completed fans out BY
 * SESSION MODE (subscription -> existing activation path, payment -> the
 * billing.payments mirror path), and the payment-mode lifecycle events
 * (checkout.session.expired / payment_intent.payment_failed) are routed to the
 * payment handler. Asserted through ctx side-effects (subscriptions.upsert vs
 * payments.upsert) so the wiring — not the handlers' internals — is under test.
 */
import { routeWebhookEvent, HANDLERS } from '../../src/handlers/webhook-router';

const ORG_ID = '33333333-3333-4333-8333-333333333333';
const BASIC_PRICE_ID = 'price_1TnCqVDaNn3aKLEz05TbFbFQ';

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

function makeCtx() {
  return {
    customers: {
      findByStripeCustomerId: jest.fn().mockResolvedValue({
        id: 'localcust_1',
        entityType: 'organization',
        entityId: ORG_ID,
        stripeCustomerId: 'cus_1',
      }),
    },
    subscriptions: { upsert: jest.fn().mockResolvedValue({}) },
    plans: { findByPriceId: jest.fn().mockResolvedValue({ tierName: 'basic' }) },
    payments: {
      upsert: jest.fn().mockImplementation(async (row: any) => ({ ...mirrorRow(), ...row })),
      getBySessionId: jest.fn().mockResolvedValue(mirrorRow()),
      findByOrder: jest.fn().mockResolvedValue(mirrorRow()),
    },
    permit: { syncPlanToPermit: jest.fn().mockResolvedValue(true) },
    emitter: {
      subscriptionChanged: jest.fn().mockResolvedValue(undefined),
      paymentCompleted: jest.fn().mockResolvedValue(undefined),
    },
    writePlanCache: jest.fn().mockResolvedValue(undefined),
    retrieveSubscription: jest.fn().mockResolvedValue({
      id: 'sub_test123',
      customer: 'cus_1',
      status: 'active',
      items: { data: [{ price: { id: BASIC_PRICE_ID }, quantity: 1 }] },
      trial_start: null,
      trial_end: null,
      current_period_start: 1_750_000_000,
      current_period_end: 1_752_000_000,
      cancel_at_period_end: false,
      canceled_at: null,
    }),
  } as any;
}

function completedEvent(mode: string, extra: any = {}) {
  return {
    id: 'evt_1',
    type: 'checkout.session.completed',
    created: 1_752_000_000,
    data: {
      object: {
        id: mode === 'payment' ? 'cs_pay_1' : 'cs_sub_1',
        mode,
        status: 'complete',
        payment_status: 'paid',
        customer: 'cus_1',
        ...extra,
      },
    },
  } as any;
}

describe('webhook-router — checkout.session.completed mode dispatch', () => {
  it('mode=subscription -> subscription activation path (payments untouched)', async () => {
    const ctx = makeCtx();
    await routeWebhookEvent(
      completedEvent('subscription', {
        subscription: 'sub_test123',
        metadata: { organizationId: ORG_ID },
      }),
      ctx,
    );

    expect(ctx.subscriptions.upsert).toHaveBeenCalledTimes(1);
    expect(ctx.emitter.subscriptionChanged).toHaveBeenCalledTimes(1);
    expect(ctx.payments.upsert).not.toHaveBeenCalled();
    expect(ctx.emitter.paymentCompleted).not.toHaveBeenCalled();
  });

  it('absent mode (legacy) -> subscription activation path (unchanged behaviour)', async () => {
    const ctx = makeCtx();
    await routeWebhookEvent(
      completedEvent(undefined as any, {
        subscription: 'sub_test123',
        metadata: { organizationId: ORG_ID },
      }),
      ctx,
    );
    expect(ctx.subscriptions.upsert).toHaveBeenCalledTimes(1);
    expect(ctx.payments.upsert).not.toHaveBeenCalled();
  });

  it('mode=payment -> payments mirror path (subscriptions untouched)', async () => {
    const ctx = makeCtx();
    await routeWebhookEvent(
      completedEvent('payment', {
        payment_intent: 'pi_1',
        amount_total: 85000,
        currency: 'usd',
        client_reference_id: 'order-42',
        metadata: { productKey: 'mendys-datasets', externalOrderId: 'order-42' },
      }),
      ctx,
    );

    expect(ctx.payments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'cs_pay_1', status: 'paid' }),
    );
    expect(ctx.emitter.paymentCompleted).toHaveBeenCalledTimes(1);
    expect(ctx.subscriptions.upsert).not.toHaveBeenCalled();
    expect(ctx.emitter.subscriptionChanged).not.toHaveBeenCalled();
  });

  it('mode=setup -> neither path mutates anything', async () => {
    const ctx = makeCtx();
    await routeWebhookEvent(completedEvent('setup'), ctx);
    expect(ctx.subscriptions.upsert).not.toHaveBeenCalled();
    expect(ctx.payments.upsert).not.toHaveBeenCalled();
  });
});

describe('webhook-router — payment lifecycle routing', () => {
  it('routes checkout.session.expired to the payment handler', async () => {
    const ctx = makeCtx();
    await routeWebhookEvent(
      {
        id: 'evt_2',
        type: 'checkout.session.expired',
        created: 1_752_000_000,
        data: {
          object: {
            id: 'cs_pay_1',
            mode: 'payment',
            status: 'expired',
            payment_status: 'unpaid',
            customer: 'cus_1',
            metadata: { productKey: 'mendys-datasets', externalOrderId: 'order-42' },
          },
        },
      } as any,
      ctx,
    );
    expect(ctx.payments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'expired' }),
    );
    expect(ctx.emitter.paymentCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'expired' }),
    );
  });

  it('routes payment_intent.payment_failed to the payment handler', async () => {
    const ctx = makeCtx();
    await routeWebhookEvent(
      {
        id: 'evt_3',
        type: 'payment_intent.payment_failed',
        created: 1_752_000_000,
        data: {
          object: {
            id: 'pi_1',
            object: 'payment_intent',
            metadata: { productKey: 'mendys-datasets', externalOrderId: 'order-42' },
          },
        },
      } as any,
      ctx,
    );
    expect(ctx.payments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(ctx.emitter.paymentCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('has explicit HANDLERS entries for the payment lifecycle events', () => {
    expect(HANDLERS['checkout.session.completed']).toBeDefined();
    expect(HANDLERS['checkout.session.expired']).toBeDefined();
    expect(HANDLERS['payment_intent.payment_failed']).toBeDefined();
  });

  it('unmapped event types are a logged no-op', async () => {
    const ctx = makeCtx();
    await expect(
      routeWebhookEvent({ id: 'evt_4', type: 'charge.refunded', data: { object: {} } } as any, ctx),
    ).resolves.toBeUndefined();
  });
});
