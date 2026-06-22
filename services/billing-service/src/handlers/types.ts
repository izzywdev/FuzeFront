import type Stripe from 'stripe';
import { CustomerRepository } from '../repositories/customer.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { PlanRepository } from '../repositories/plan.repository';
import { PermitSyncService } from '../services/permit.service';
import { BillingEventEmitter } from '../kafka/producer';

/**
 * Dependencies passed to every webhook handler. Injected so handlers are
 * unit-testable with fakes (no DB / Stripe / Kafka / Permit needed).
 *
 * NOTE (per-service-DB boundary): handlers MUST NOT write to the platform's
 * public.users / public.organizations tables. billing-service owns only the
 * `billing` schema. Plan-state for those public entities is maintained by the
 * BACKEND, which consumes the `billing.subscription.changed` event emitted here
 * and projects it onto its own tables. The handler's job is: mirror locally,
 * sync Permit, and emit the event.
 */
export interface HandlerContext {
  customers: CustomerRepository;
  subscriptions: SubscriptionRepository;
  plans: PlanRepository;
  permit: PermitSyncService;
  emitter: BillingEventEmitter;
}

export type StripeEventHandler = (
  event: Stripe.Event,
  ctx: HandlerContext,
) => Promise<void>;
