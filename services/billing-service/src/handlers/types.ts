import type Stripe from 'stripe';
import { CustomerRepository } from '../repositories/customer.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { PlanRepository } from '../repositories/plan.repository';
import { PaymentRepository } from '../repositories/payment.repository';
import { InvoiceRepository } from '../repositories/invoice.repository';
import { PaymentProvider } from '../providers/payment-provider';
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
  /** One-time payment-mode Checkout mirror (billing.payments). */
  payments: PaymentRepository;
  /**
   * DB-backed invoice store + neutral provider port. Injected by app.ts so the
   * invoice-synced handler can persist invoice.* webhooks. Optional so handler
   * unit tests that don't exercise invoice persistence can omit them.
   */
  invoiceRepo?: InvoiceRepository;
  provider?: PaymentProvider;
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
  /**
   * Retrieves a full Stripe Subscription by id. Used by the
   * `checkout.session.completed` handler: the session payload only carries the
   * subscription id, so we fetch the object to mirror its price/status/periods.
   * Optional + injected so handler unit tests can stub it without a Stripe SDK.
   */
  retrieveSubscription?: (stripeSubscriptionId: string) => Promise<Stripe.Subscription>;
}

export type StripeEventHandler = (
  event: Stripe.Event,
  ctx: HandlerContext,
) => Promise<void>;
