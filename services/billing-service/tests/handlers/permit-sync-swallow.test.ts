/**
 * Proves the load-bearing constraint from PermitSyncService's header comment:
 * a Security API outage must NOT fail Stripe webhook processing. This wires a
 * REAL PermitSyncService (flag ON) backed by a THROWING AuthzClient into an
 * actual webhook handler, and asserts the handler completes normally —
 * `handleCheckoutCompleted` resolves, does not throw/reject, still upserts
 * the subscription mirror, and still emits `billing.subscription.changed`
 * (Stripe must not see a failure and pile up retries).
 */
const FLAG_ENV_KEY = 'FUZEFRONT_BILLING_AUTHZ_ENABLED';

import { handleCheckoutCompleted } from '../../src/handlers/checkout-completed';
import { PermitSyncService } from '../../src/services/permit.service';

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

describe('webhook handler resilience when the Security API sync throws', () => {
  const originalFlag = process.env[FLAG_ENV_KEY];

  beforeEach(() => {
    process.env[FLAG_ENV_KEY] = 'true'; // flag ON so the sync is actually attempted
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env[FLAG_ENV_KEY];
    else process.env[FLAG_ENV_KEY] = originalFlag;
  });

  it('handleCheckoutCompleted resolves normally even though setAttributes throws', async () => {
    const authz = {
      check: jest.fn(),
      bulkCheck: jest.fn(),
      grant: jest.fn(),
      revoke: jest.fn(),
      listGrants: jest.fn(),
      setAttributes: jest.fn().mockRejectedValue(new Error('Security API unreachable')),
    } as any;
    const logger = { error: jest.fn(), warn: jest.fn() };
    const permit = new PermitSyncService(authz, () => Promise.resolve('tok'), logger);

    const ctx = {
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
      permit,
      emitter: { subscriptionChanged: jest.fn().mockResolvedValue(undefined) },
      retrieveSubscription: jest.fn().mockResolvedValue(makeSubscription()),
    } as any;

    // The whole point: this must NOT throw/reject.
    await expect(handleCheckoutCompleted(checkoutEvent(), ctx)).resolves.toBeUndefined();

    expect(authz.setAttributes).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
    // Webhook processing continued: the mirror upsert and event emission
    // still happened, exactly as if Permit sync had succeeded.
    expect(ctx.subscriptions.upsert).toHaveBeenCalledTimes(1);
    expect(ctx.emitter.subscriptionChanged).toHaveBeenCalledTimes(1);
  });
});
