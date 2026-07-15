import { handleCheckoutCompleted } from '../../src/handlers/checkout-completed';

const BASIC_PRICE_ID = 'price_1TnCqVDaNn3aKLEz05TbFbFQ';

function makeSubscription(overrides: any = {}) {
  return {
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
    ...overrides,
  };
}

function makeCtx(overrides: any = {}) {
  return {
    customers: {
      findByStripeCustomerId: jest.fn().mockResolvedValue({
        id: 'localcust_1',
        entityType: 'organization',
        entityId: 'org-1',
        stripeCustomerId: 'cus_1',
      }),
    },
    subscriptions: { upsert: jest.fn().mockResolvedValue({}) },
    plans: { findByPriceId: jest.fn().mockResolvedValue({ tierName: 'basic' }) },
    permit: { syncPlanToPermit: jest.fn().mockResolvedValue(true) },
    emitter: { subscriptionChanged: jest.fn().mockResolvedValue(undefined) },
    writePlanCache: jest.fn().mockResolvedValue(undefined),
    retrieveSubscription: jest.fn().mockResolvedValue(makeSubscription()),
    ...overrides,
  } as any;
}

function checkoutEvent(overrides: any = {}) {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_live_1',
        mode: 'subscription',
        status: 'complete',
        payment_status: 'paid',
        customer: 'cus_1',
        subscription: 'sub_test123',
        metadata: { organizationId: 'org-1' },
        ...overrides,
      },
    },
  } as any;
}

describe('handleCheckoutCompleted', () => {
  it('activates the local subscription mirror for the right price (upsert + Permit + cache + event)', async () => {
    const ctx = makeCtx();
    await handleCheckoutCompleted(checkoutEvent(), ctx);

    expect(ctx.retrieveSubscription).toHaveBeenCalledWith('sub_test123');
    expect(ctx.subscriptions.upsert).toHaveBeenCalledTimes(1);
    const upserted = ctx.subscriptions.upsert.mock.calls[0][0];
    expect(upserted).toEqual(
      expect.objectContaining({
        customerId: 'localcust_1',
        subscriptionId: 'sub_test123',
        priceId: BASIC_PRICE_ID,
        planTier: 'basic',
        status: 'active',
        seatQuantity: 1,
      }),
    );
    expect(ctx.permit.syncPlanToPermit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'organization', entityId: 'org-1', planTier: 'basic', status: 'active' }),
    );
    expect(ctx.writePlanCache).toHaveBeenCalledWith(
      expect.objectContaining({ planTier: 'basic', status: 'active' }),
    );
    expect(ctx.emitter.subscriptionChanged).toHaveBeenCalledWith(
      expect.objectContaining({ planTier: 'basic', status: 'active', stripeSubscriptionId: 'sub_test123' }),
    );
  });

  it('no-ops when no local customer maps to the Stripe customer', async () => {
    const ctx = makeCtx();
    ctx.customers.findByStripeCustomerId.mockResolvedValue(null);
    await handleCheckoutCompleted(checkoutEvent(), ctx);
    expect(ctx.subscriptions.upsert).not.toHaveBeenCalled();
  });

  it('ignores non-subscription mode sessions', async () => {
    const ctx = makeCtx();
    await handleCheckoutCompleted(checkoutEvent({ mode: 'payment' }), ctx);
    expect(ctx.subscriptions.upsert).not.toHaveBeenCalled();
  });

  it('skips unpaid sessions', async () => {
    const ctx = makeCtx();
    await handleCheckoutCompleted(checkoutEvent({ payment_status: 'unpaid' }), ctx);
    expect(ctx.subscriptions.upsert).not.toHaveBeenCalled();
  });

  it('falls back to a minimal active mirror when subscription retrieval fails', async () => {
    const ctx = makeCtx();
    ctx.retrieveSubscription.mockRejectedValue(new Error('stripe down'));
    await handleCheckoutCompleted(checkoutEvent(), ctx);

    expect(ctx.subscriptions.upsert).toHaveBeenCalledTimes(1);
    const upserted = ctx.subscriptions.upsert.mock.calls[0][0];
    expect(upserted).toEqual(
      expect.objectContaining({ subscriptionId: 'sub_test123', status: 'active' }),
    );
    expect(ctx.emitter.subscriptionChanged).toHaveBeenCalled();
  });

  it('handles a session whose subscription/customer are expanded objects', async () => {
    const ctx = makeCtx();
    await handleCheckoutCompleted(
      checkoutEvent({ customer: { id: 'cus_1' }, subscription: { id: 'sub_test123' } }),
      ctx,
    );
    expect(ctx.customers.findByStripeCustomerId).toHaveBeenCalledWith('cus_1');
    expect(ctx.retrieveSubscription).toHaveBeenCalledWith('sub_test123');
    expect(ctx.subscriptions.upsert).toHaveBeenCalledTimes(1);
  });
});
