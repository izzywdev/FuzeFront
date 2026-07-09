import { handleSubscriptionUpdated } from '../../src/handlers/subscription-updated';

function makeCtx() {
  return {
    customers: {
      findByStripeCustomerId: jest.fn().mockResolvedValue({
        id: 'localcust_1', entityType: 'organization', entityId: 'org-1', stripeCustomerId: 'cus_1',
      }),
    },
    subscriptions: { upsert: jest.fn().mockResolvedValue({}) },
    plans: { findByPriceId: jest.fn().mockResolvedValue({ tierName: 'pro' }) },
    permit: { syncPlanToPermit: jest.fn().mockResolvedValue(true) },
    emitter: { subscriptionChanged: jest.fn().mockResolvedValue(undefined) },
  } as any;
}

function subEvent(type: string, overrides: any = {}) {
  return {
    type,
    data: {
      object: {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        items: { data: [{ price: { id: 'price_pro' }, quantity: 3 }] },
        trial_end: null,
        ...overrides,
      },
    },
  } as any;
}

describe('handleSubscriptionUpdated', () => {
  it('on updated: upserts mirror, syncs Permit, emits event (no public-table write)', async () => {
    const ctx = makeCtx();
    await handleSubscriptionUpdated(subEvent('customer.subscription.updated'), ctx);

    expect(ctx.subscriptions.upsert).toHaveBeenCalledTimes(1);
    expect(ctx.permit.syncPlanToPermit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'organization', entityId: 'org-1', planTier: 'pro', status: 'active', seatQuantity: 3 }),
    );
    // The handler must NOT carry any writePlanCache dependency — plan-state for
    // public.users/organizations is projected by the backend from the event.
    expect((ctx as Record<string, unknown>).writePlanCache).toBeUndefined();
    expect(ctx.emitter.subscriptionChanged).toHaveBeenCalledWith(
      expect.objectContaining({ planTier: 'pro', status: 'active', stripeSubscriptionId: 'sub_1' }),
    );
  });

  it('on deleted: downgrades to free/canceled', async () => {
    const ctx = makeCtx();
    await handleSubscriptionUpdated(subEvent('customer.subscription.deleted'), ctx);

    expect(ctx.permit.syncPlanToPermit).toHaveBeenCalledWith(
      expect.objectContaining({ planTier: 'free', status: 'canceled' }),
    );
  });

  it('no-ops when no local customer maps to the Stripe customer', async () => {
    const ctx = makeCtx();
    ctx.customers.findByStripeCustomerId.mockResolvedValue(null);
    await handleSubscriptionUpdated(subEvent('customer.subscription.updated'), ctx);
    expect(ctx.subscriptions.upsert).not.toHaveBeenCalled();
  });
});
