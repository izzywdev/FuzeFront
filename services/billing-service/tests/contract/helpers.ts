/**
 * Independent contract-test harness for the billing-service.
 *
 * These tests are authored by the INDEPENDENT verification stream (test-engineer)
 * and assert conformance to the FROZEN contract `services/billing-service/openapi.yaml`,
 * NOT to the implementation's own assumptions. They drive the *real* router wiring
 * via `createApp(deps)` (src/app.ts) with a fully-mocked AppDeps so no DB/Stripe is
 * touched. A failing test here against a real bug is a valid deliverable — it is NOT
 * fixed by weakening the test.
 *
 * Live Basic price context (mocked, never hit): price_1TnCqVDaNn3aKLEz05TbFbFQ ($9/mo).
 */
import type { Application } from 'express';
import { createApp, AppDeps } from '../../src/app';
import type {
  BillingSubscription,
  CreateSubscriptionResponse,
  Plan,
} from '../../src/types';

export const BASIC_PRICE_ID = 'price_1TnCqVDaNn3aKLEz05TbFbFQ';
export const INTERNAL_TOKEN = 'test-internal-token-abc123';

/** Valid uuids for entityId fields. */
export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
export const ORG_ID = '33333333-3333-4333-8333-333333333333';
export const OTHER_ORG_ID = '44444444-4444-4444-8444-444444444444';

/** A spec-conformant BillingSubscription fixture (all 14 required fields). */
export function makeSubscription(overrides: Partial<BillingSubscription> = {}): BillingSubscription {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    customerId: '66666666-6666-4666-8666-666666666666',
    stripeSubscriptionId: 'sub_test123',
    stripePriceId: BASIC_PRICE_ID,
    planTier: 'starter',
    status: 'active',
    seatQuantity: 1,
    trialStart: null,
    trialEnd: null,
    currentPeriodStart: '2026-06-01T00:00:00.000Z',
    currentPeriodEnd: '2026-07-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    canceledAt: null,
    ...overrides,
  };
}

/** A spec-conformant Plan fixture (the $9/mo Basic plan). */
export function makeBasicPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    stripePriceId: BASIC_PRICE_ID,
    stripeProductId: 'prod_basic',
    tierName: 'starter',
    displayName: 'Basic',
    billingInterval: 'month',
    unitAmount: 900,
    currency: 'usd',
    seatBased: false,
    meteredMeterName: null,
    features: ['Core platform access'],
    isActive: true,
    sortOrder: 1,
    ...overrides,
  } as Plan;
}

export interface DepStubs {
  plans: { getActivePlans: jest.Mock };
  subscriptionService: {
    create: jest.Mock;
    update: jest.Mock;
    cancel: jest.Mock;
  };
  subscriptionRepo: {
    findByStripeId: jest.Mock;
    upsert: jest.Mock;
    findByCustomer: jest.Mock;
  };
  customers: { ensureCustomer: jest.Mock };
  stripe: {
    setupIntents: { create: jest.Mock };
    customers: { createBalanceTransaction: jest.Mock };
    webhooks: { constructEvent: jest.Mock };
  };
  webhook: {
    stripe: { webhooks: { constructEvent: jest.Mock } };
    webhookSecret: string;
    events: { recordIfNew: jest.Mock };
    ctx: any;
  };
}

/**
 * Builds the real app with fully-mocked deps. Pass internalToken to exercise the
 * auth guard (omit to test the dev-bypass path documented in the spec's security
 * scheme description).
 */
export function buildApp(
  opts: { internalToken?: string; stubs?: Partial<DepStubs> } = {},
): { app: Application; stubs: DepStubs } {
  const constructEvent = jest.fn();

  const stubs: DepStubs = {
    plans: { getActivePlans: jest.fn().mockResolvedValue([makeBasicPlan()]) },
    subscriptionService: {
      create: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
    },
    subscriptionRepo: {
      findByStripeId: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      findByCustomer: jest.fn().mockResolvedValue(null),
    },
    customers: {
      ensureCustomer: jest.fn().mockResolvedValue({
        id: '66666666-6666-4666-8666-666666666666',
        entityType: 'user',
        entityId: USER_ID,
        stripeCustomerId: 'cus_test123',
      }),
    },
    stripe: {
      setupIntents: { create: jest.fn() },
      customers: { createBalanceTransaction: jest.fn() },
      webhooks: { constructEvent },
    },
    webhook: {
      stripe: { webhooks: { constructEvent } },
      webhookSecret: 'whsec_test',
      events: { recordIfNew: jest.fn().mockResolvedValue(true) },
      ctx: {
        customers: { findByStripeCustomerId: jest.fn().mockResolvedValue(null) },
        subscriptions: {},
        plans: {},
        permit: {},
        emitter: {},
        writePlanCache: jest.fn(),
      },
    },
    ...opts.stubs,
  };

  const deps: AppDeps = {
    stripe: stubs.stripe as any,
    internalToken: opts.internalToken,
    plans: stubs.plans as any,
    subscriptionService: stubs.subscriptionService as any,
    subscriptionRepo: stubs.subscriptionRepo as any,
    customers: stubs.customers as any,
    webhook: stubs.webhook as any,
  };

  return { app: createApp(deps), stubs };
}

export function authHeader(token = INTERNAL_TOKEN): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

export type { BillingSubscription, CreateSubscriptionResponse, Plan };
