import { handleOrgDeleted } from '../../src/kafka/org-deleted.handler';
import {
  FuzeEvent,
  TOPICS,
  IdentityOrgDeletedPayloadV1,
} from '@fuzefront/shared/kafka';
import { BillingCustomer, BillingSubscription } from '../../src/types';

const ORG_ID = '33333333-3333-3333-3333-333333333333';
const OWNER_ID = '22222222-2222-2222-2222-222222222222';

function deletedEvent(
  overrides: Partial<IdentityOrgDeletedPayloadV1> = {},
): FuzeEvent<IdentityOrgDeletedPayloadV1> {
  return {
    version: '1.0',
    topic: TOPICS.IDENTITY_ORG_DELETED,
    correlationId: 'corr-org-del',
    occurredAt: new Date().toISOString(),
    payload: {
      organizationId: ORG_ID,
      slug: 'acme',
      ownerId: OWNER_ID,
      cascade: 'soft',
      ...overrides,
    },
  };
}

const customer: BillingCustomer = {
  id: 'localcust_1',
  entityType: 'organization',
  entityId: ORG_ID,
  stripeCustomerId: 'cus_1',
};

function subscription(overrides: Partial<BillingSubscription> = {}): BillingSubscription {
  return {
    id: 'localsub_1',
    customerId: 'localcust_1',
    subscriptionId: 'sub_1',
    priceId: 'price_pro',
    planTier: 'pro',
    status: 'active',
    seatQuantity: 1,
    trialStart: null,
    trialEnd: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    ...overrides,
  };
}

function makeDeps(opts: {
  customer?: BillingCustomer | null;
  subscription?: BillingSubscription | null;
}) {
  const cancel = jest.fn().mockResolvedValue(subscription({ cancelAtPeriodEnd: true }));
  const cancelImmediately = jest.fn().mockResolvedValue(subscription({ status: 'canceled' }));
  const findByEntity = jest.fn().mockResolvedValue(opts.customer ?? null);
  const findByCustomer = jest.fn().mockResolvedValue(opts.subscription ?? null);
  return {
    deps: {
      customers: { findByEntity } as any,
      subscriptions: { findByCustomer } as any,
      subscriptionService: { cancel, cancelImmediately },
    },
    cancel,
    cancelImmediately,
    findByEntity,
    findByCustomer,
  };
}

describe('handleOrgDeleted (billing)', () => {
  it('soft cascade cancels the subscription at period end', async () => {
    const { deps, cancel, cancelImmediately, findByEntity } = makeDeps({
      customer,
      subscription: subscription(),
    });
    await handleOrgDeleted(deletedEvent({ cascade: 'soft' }), deps);
    expect(findByEntity).toHaveBeenCalledWith('organization', ORG_ID);
    expect(cancel).toHaveBeenCalledWith('sub_1');
    expect(cancelImmediately).not.toHaveBeenCalled();
  });

  it('hard cascade cancels the subscription immediately', async () => {
    const { deps, cancel, cancelImmediately } = makeDeps({
      customer,
      subscription: subscription(),
    });
    await handleOrgDeleted(deletedEvent({ cascade: 'hard' }), deps);
    expect(cancelImmediately).toHaveBeenCalledWith('sub_1');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('is a no-op when the org has no billing customer', async () => {
    const { deps, cancel, cancelImmediately, findByCustomer } = makeDeps({
      customer: null,
    });
    await handleOrgDeleted(deletedEvent(), deps);
    expect(findByCustomer).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(cancelImmediately).not.toHaveBeenCalled();
  });

  it('is a no-op when the customer has no subscription', async () => {
    const { deps, cancel, cancelImmediately } = makeDeps({
      customer,
      subscription: null,
    });
    await handleOrgDeleted(deletedEvent(), deps);
    expect(cancel).not.toHaveBeenCalled();
    expect(cancelImmediately).not.toHaveBeenCalled();
  });

  it('skips an already-canceled subscription (idempotent on redelivery)', async () => {
    const { deps, cancel, cancelImmediately } = makeDeps({
      customer,
      subscription: subscription({ status: 'canceled' }),
    });
    await handleOrgDeleted(deletedEvent({ cascade: 'hard' }), deps);
    expect(cancel).not.toHaveBeenCalled();
    expect(cancelImmediately).not.toHaveBeenCalled();
  });

  it('propagates a cancel failure so the consumer can dead-letter', async () => {
    const { deps, cancel } = makeDeps({ customer, subscription: subscription() });
    cancel.mockRejectedValueOnce(new Error('stripe down'));
    await expect(handleOrgDeleted(deletedEvent(), deps)).rejects.toThrow(/stripe down/);
  });
});
