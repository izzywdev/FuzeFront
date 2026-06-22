import { handleInvoicePaid } from '../../src/handlers/invoice-paid';
import { handleInvoiceFailed } from '../../src/handlers/invoice-failed';
import { handleTrialEnding } from '../../src/handlers/trial-ending';

function makeCtx() {
  return {
    customers: {
      findByStripeCustomerId: jest.fn().mockResolvedValue({
        id: 'localcust_1',
        entityType: 'organization',
        entityId: 'org-1',
        stripeCustomerId: 'cus_1',
      }),
    },
    subscriptions: {
      findByCustomer: jest.fn().mockResolvedValue({
        stripeSubscriptionId: 'sub_1',
        planTier: 'pro',
        trialEnd: null,
      }),
    },
    plans: { findByPriceId: jest.fn().mockResolvedValue({ tierName: 'starter' }) },
    permit: { syncPlanToPermit: jest.fn().mockResolvedValue(true) },
    emitter: {
      subscriptionChanged: jest.fn().mockResolvedValue(undefined),
      paymentFailed: jest.fn().mockResolvedValue(undefined),
      trialEnding: jest.fn().mockResolvedValue(undefined),
    },
    writePlanCache: jest.fn().mockResolvedValue(undefined),
  } as any;
}

const invoiceEvent = (type: string, overrides: any = {}) =>
  ({
    type,
    data: {
      object: {
        id: 'in_1',
        customer: 'cus_1',
        amount_due: 1500,
        currency: 'usd',
        ...overrides,
      },
    },
  }) as any;

const trialEvent = () =>
  ({
    type: 'customer.subscription.trial_will_end',
    data: {
      object: {
        id: 'sub_1',
        customer: 'cus_1',
        trial_end: 1893456000,
        items: { data: [{ price: { id: 'price_pro' } }] },
      },
    },
  }) as any;

describe('handleInvoicePaid', () => {
  it('syncs Permit active and emits subscriptionChanged active', async () => {
    const ctx = makeCtx();
    await handleInvoicePaid(invoiceEvent('invoice.payment_succeeded'), ctx);
    expect(ctx.permit.syncPlanToPermit).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', planTier: 'pro' }),
    );
    expect(ctx.emitter.subscriptionChanged).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', planTier: 'pro', stripeSubscriptionId: 'sub_1' }),
    );
  });

  it('no-ops when no customer maps', async () => {
    const ctx = makeCtx();
    ctx.customers.findByStripeCustomerId.mockResolvedValue(null);
    await handleInvoicePaid(invoiceEvent('invoice.payment_succeeded'), ctx);
    expect(ctx.permit.syncPlanToPermit).not.toHaveBeenCalled();
  });
});

describe('handleInvoiceFailed', () => {
  it('syncs Permit past_due and emits paymentFailed with invoice details', async () => {
    const ctx = makeCtx();
    await handleInvoiceFailed(invoiceEvent('invoice.payment_failed'), ctx);
    expect(ctx.permit.syncPlanToPermit).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'past_due' }),
    );
    expect(ctx.emitter.paymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'in_1', amountDue: 1500, currency: 'usd' }),
    );
  });

  it('no-ops when no customer maps', async () => {
    const ctx = makeCtx();
    ctx.customers.findByStripeCustomerId.mockResolvedValue(null);
    await handleInvoiceFailed(invoiceEvent('invoice.payment_failed'), ctx);
    expect(ctx.emitter.paymentFailed).not.toHaveBeenCalled();
  });
});

describe('handleTrialEnding', () => {
  it('emits trialEnding with the resolved plan tier and ISO trial end', async () => {
    const ctx = makeCtx();
    await handleTrialEnding(trialEvent(), ctx);
    expect(ctx.emitter.trialEnding).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'organization',
        entityId: 'org-1',
        planTier: 'starter',
      }),
    );
    const arg = ctx.emitter.trialEnding.mock.calls[0][0];
    expect(typeof arg.trialEnd).toBe('string');
    expect(arg.trialEnd).not.toBe('');
  });

  it('no-ops when no customer maps', async () => {
    const ctx = makeCtx();
    ctx.customers.findByStripeCustomerId.mockResolvedValue(null);
    await handleTrialEnding(trialEvent(), ctx);
    expect(ctx.emitter.trialEnding).not.toHaveBeenCalled();
  });
});
