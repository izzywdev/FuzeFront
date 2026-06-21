import type Stripe from 'stripe';
import { CustomerRepository } from '../repositories/customer.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { PlanRepository } from '../repositories/plan.repository';
import { PermitSyncService } from '../services/permit.service';
import { BillingEventEmitter } from '../kafka/producer';

/**
 * Dependencies passed to every webhook handler. Injected so handlers are
 * unit-testable with fakes (no DB / Stripe / Kafka / Permit needed).
 */
export interface HandlerContext {
  customers: CustomerRepository;
  subscriptions: SubscriptionRepository;
  plans: PlanRepository;
  permit: PermitSyncService;
  emitter: BillingEventEmitter;
  /** Writes the plan-tier hot-path cache columns back to public.users/organizations. */
  writePlanCache: (args: {
    entityType: 'user' | 'organization';
    entityId: string;
    planTier: string;
    status: string;
    trialEnd: string | null;
  }) => Promise<void>;
}

export type StripeEventHandler = (
  event: Stripe.Event,
  ctx: HandlerContext,
) => Promise<void>;
