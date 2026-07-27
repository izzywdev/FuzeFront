import { SubscriptionService } from '../../src/services/subscription.service';
import { SubscriptionRepository, SubscriptionUpsert } from '../../src/repositories/subscription.repository';
import { BillingSubscription } from '../../src/types';

class FakeSubRepo implements SubscriptionRepository {
  rows: BillingSubscription[] = [];
  async upsert(row: SubscriptionUpsert): Promise<BillingSubscription> {
    const mapped: BillingSubscription = { id: 'localsub_1', ...row };
    const i = this.rows.findIndex((r) => r.stripeSubscriptionId === row.stripeSubscriptionId);
    if (i >= 0) this.rows[i] = mapped;
    else this.rows.push(mapped);
    return mapped;
  }
  async findByStripeId(id: string) {
    return this.rows.find((r) => r.stripeSubscriptionId === id) ?? null;
  }
  async findByCustomer(cid: string) {
    return this.rows.find((r) => r.customerId === cid) ?? null;
  }
}

const fakeCustomers = {
  ensureCustomer: jest.fn().mockResolvedValue({
    id: 'localcust_1',
    entityType: 'user',
    entityId: 'user-1',
    stripeCustomerId: 'cus_1',
  }),
} as any;

const plansList = [
  { stripePriceId: 'price_starter', tierName: 'starter', unitAmount: 900 },
  { stripePriceId: 'price_pro', tierName: 'pro', unitAmount: 2900 },
];
const fakePlans = { getActivePlans: jest.fn().mockResolvedValue(plansList) } as any;

function baseStripeSub(overrides: any = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    items: { data: [{ id: 'si_1', price: { id: 'price_starter' }, quantity: 1 }] },
    trial_start: null,
    trial_end: null,
    current_period_start: 1700000000,
    current_period_end: 1702592000,
    cancel_at_period_end: false,
    canceled_at: null,
    latest_invoice: null,
    pending_setup_intent: null,
    ...overrides,
  };
}

describe('SubscriptionService.create', () => {
  it('creates a Stripe subscription with automatic_tax and persists the mirror', async () => {
    const repo = new FakeSubRepo();
    const create = jest.fn().mockResolvedValue(baseStripeSub());
    const stripe = { subscriptions: { create } } as any;
    const svc = new SubscriptionService(stripe, fakeCustomers, fakePlans, repo);

    const res = await svc.create({ entityType: 'user', entityId: 'user-1', priceId: 'price_starter' });

    const [params, opts] = create.mock.calls[0];
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.payment_behavior).toBe('default_incomplete');
    expect(opts.idempotencyKey).toContain('sub-create-user-user-1-price_starter');
    expect(res.subscription.planTier).toBe('starter');
    expect(res.requiresAction).toBe(false);
    expect(repo.rows).toHaveLength(1);
  });

  it('passes trial_period_days for a no-card trial', async () => {
    const repo = new FakeSubRepo();
    const create = jest.fn().mockResolvedValue(baseStripeSub({ status: 'trialing', trial_end: 1701000000 }));
    const stripe = { subscriptions: { create } } as any;
    const svc = new SubscriptionService(stripe, fakeCustomers, fakePlans, repo);

    await svc.create({ entityType: 'user', entityId: 'user-1', priceId: 'price_starter', trial: true });

    const [params] = create.mock.calls[0];
    expect(params.trial_period_days).toBe(14);
    expect(params.trial_settings.end_behavior.missing_payment_method).toBe('cancel');
  });

  it('surfaces client_secret + requiresAction when SCA is needed (incomplete)', async () => {
    const repo = new FakeSubRepo();
    const sub = baseStripeSub({
      status: 'incomplete',
      latest_invoice: { payment_intent: { client_secret: 'pi_secret_123' } },
    });
    const create = jest.fn().mockResolvedValue(sub);
    const stripe = { subscriptions: { create } } as any;
    const svc = new SubscriptionService(stripe, fakeCustomers, fakePlans, repo);

    const res = await svc.create({ entityType: 'user', entityId: 'user-1', priceId: 'price_starter' });

    expect(res.clientSecret).toBe('pi_secret_123');
    expect(res.requiresAction).toBe(true);
  });
});

describe('SubscriptionService.update', () => {
  it('upgrade uses create_prorations', async () => {
    const repo = new FakeSubRepo();
    await repo.upsert({
      customerId: 'localcust_1', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter',
      planTier: 'starter', status: 'active', seatQuantity: 1, trialStart: null, trialEnd: null,
      currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: null,
    });
    const retrieve = jest.fn().mockResolvedValue(baseStripeSub());
    const update = jest.fn().mockResolvedValue(baseStripeSub({ items: { data: [{ id: 'si_1', price: { id: 'price_pro' }, quantity: 1 }] } }));
    const stripe = { subscriptions: { retrieve, update } } as any;
    const svc = new SubscriptionService(stripe, fakeCustomers, fakePlans, repo);

    await svc.update('sub_1', { priceId: 'price_pro' });

    const [, params] = update.mock.calls[0];
    expect(params.proration_behavior).toBe('create_prorations');
  });

  it('downgrade uses none + billing_cycle_anchor unchanged (period-end)', async () => {
    const repo = new FakeSubRepo();
    await repo.upsert({
      customerId: 'localcust_1', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_pro',
      planTier: 'pro', status: 'active', seatQuantity: 1, trialStart: null, trialEnd: null,
      currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: null,
    });
    const retrieve = jest.fn().mockResolvedValue(baseStripeSub());
    const update = jest.fn().mockResolvedValue(baseStripeSub());
    const stripe = { subscriptions: { retrieve, update } } as any;
    const svc = new SubscriptionService(stripe, fakeCustomers, fakePlans, repo);

    await svc.update('sub_1', { priceId: 'price_starter' });

    const [, params] = update.mock.calls[0];
    expect(params.proration_behavior).toBe('none');
    expect(params.billing_cycle_anchor).toBe('unchanged');
  });
});

describe('SubscriptionService.cancel', () => {
  it('sets cancel_at_period_end true', async () => {
    const repo = new FakeSubRepo();
    await repo.upsert({
      customerId: 'localcust_1', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_pro',
      planTier: 'pro', status: 'active', seatQuantity: 1, trialStart: null, trialEnd: null,
      currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: null,
    });
    const update = jest.fn().mockResolvedValue(baseStripeSub({ cancel_at_period_end: true }));
    const stripe = { subscriptions: { update } } as any;
    const svc = new SubscriptionService(stripe, fakeCustomers, fakePlans, repo);

    const res = await svc.cancel('sub_1');

    const [, params] = update.mock.calls[0];
    expect(params.cancel_at_period_end).toBe(true);
    expect(res.cancelAtPeriodEnd).toBe(true);
  });
});
