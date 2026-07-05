import type Stripe from 'stripe';
import {
  BillingSubscription,
  CreateSubscriptionRequest,
  CreateSubscriptionResponse,
  UpdateSubscriptionRequest,
} from '../types';
import { CustomerService } from './customer.service';
import { PlanService } from './plan.service';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { mapStripeSubscription } from './subscription.mapper';

const DEFAULT_TRIAL_DAYS = 14;

/**
 * Subscription lifecycle against Stripe + local mirror.
 *
 * Proration policy (per spec §6 default, callable out as a product decision):
 *  - upgrade   → create_prorations (immediate credit/debit on next invoice)
 *  - downgrade → none, effective at period end
 */
export class SubscriptionService {
  constructor(
    private readonly stripe: Pick<Stripe, 'subscriptions'>,
    private readonly customers: CustomerService,
    private readonly plans: PlanService,
    private readonly repo: SubscriptionRepository,
  ) {}

  async create(req: CreateSubscriptionRequest): Promise<CreateSubscriptionResponse> {
    const customer = await this.customers.ensureCustomer(req.entityType, req.entityId);

    const params: Stripe.SubscriptionCreateParams = {
      customer: customer.stripeCustomerId,
      items: [{ price: req.priceId, quantity: req.seatQuantity ?? 1 }],
      automatic_tax: { enabled: true },
      // Expose the PaymentIntent/SetupIntent client_secret for SCA confirmation.
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
    };

    if (req.trial) {
      params.trial_period_days = req.trialPeriodDays ?? DEFAULT_TRIAL_DAYS;
      // No-card trial: don't require a payment method up front.
      params.trial_settings = { end_behavior: { missing_payment_method: 'cancel' } };
    }
    if (req.paymentMethodId) {
      params.default_payment_method = req.paymentMethodId;
    }

    const sub = await this.stripe.subscriptions.create(params, {
      idempotencyKey: `sub-create-${req.entityType}-${req.entityId}-${req.priceId}`,
    });

    const planTier = await this.resolvePlanTier(req.priceId);
    const saved = await this.repo.upsert(
      mapStripeSubscription(sub, { customerId: customer.id, planTier }),
    );

    const clientSecret = this.extractClientSecret(sub);
    return {
      subscription: saved,
      clientSecret,
      requiresAction: Boolean(clientSecret) && sub.status === 'incomplete',
    };
  }

  async update(
    stripeSubscriptionId: string,
    req: UpdateSubscriptionRequest,
  ): Promise<BillingSubscription> {
    const existing = await this.repo.findByStripeId(stripeSubscriptionId);
    if (!existing) {
      throw new Error(`Subscription not found: ${stripeSubscriptionId}`);
    }

    // Fetch the current item id so we modify (not append) the subscription item.
    const current = await this.stripe.subscriptions.retrieve(stripeSubscriptionId);
    const itemId = current.items.data[0]?.id;

    const params: Stripe.SubscriptionUpdateParams = {};
    if (req.priceId) {
      const isUpgrade = await this.isUpgrade(existing.stripePriceId, req.priceId);
      params.items = [
        { id: itemId, price: req.priceId, quantity: req.seatQuantity ?? existing.seatQuantity },
      ];
      params.proration_behavior = isUpgrade ? 'create_prorations' : 'none';
      if (!isUpgrade) {
        // Downgrade: keep the billing cycle anchor; change takes effect at period end.
        params.billing_cycle_anchor = 'unchanged';
      }
    } else if (typeof req.seatQuantity === 'number') {
      // Pure seat change: prorate (adding seats mid-cycle should bill immediately).
      params.items = [{ id: itemId, quantity: req.seatQuantity }];
      params.proration_behavior = 'create_prorations';
    }

    const updated = await this.stripe.subscriptions.update(stripeSubscriptionId, params, {
      idempotencyKey: `sub-update-${stripeSubscriptionId}-${req.priceId ?? ''}-${req.seatQuantity ?? ''}`,
    });

    const planTier = await this.resolvePlanTier(
      req.priceId ?? existing.stripePriceId,
    );
    return this.repo.upsert(
      mapStripeSubscription(updated, { customerId: existing.customerId, planTier }),
    );
  }

  /** Cancel at period end (soft cancel); Stripe keeps the sub active until then. */
  async cancel(stripeSubscriptionId: string): Promise<BillingSubscription> {
    const existing = await this.repo.findByStripeId(stripeSubscriptionId);
    if (!existing) {
      throw new Error(`Subscription not found: ${stripeSubscriptionId}`);
    }
    const updated = await this.stripe.subscriptions.update(
      stripeSubscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: `sub-cancel-${stripeSubscriptionId}` },
    );
    return this.repo.upsert(
      mapStripeSubscription(updated, {
        customerId: existing.customerId,
        planTier: existing.planTier,
      }),
    );
  }

  private async resolvePlanTier(priceId: string): Promise<string> {
    const plans = await this.plans.getActivePlans();
    return plans.find((p) => p.stripePriceId === priceId)?.tierName ?? 'unknown';
  }

  /** Upgrade vs downgrade is decided by unit_amount of the target vs current price. */
  private async isUpgrade(currentPriceId: string, nextPriceId: string): Promise<boolean> {
    const plans = await this.plans.getActivePlans();
    const cur = plans.find((p) => p.stripePriceId === currentPriceId)?.unitAmount ?? 0;
    const next = plans.find((p) => p.stripePriceId === nextPriceId)?.unitAmount ?? 0;
    return next >= cur;
  }

  private extractClientSecret(sub: Stripe.Subscription): string | undefined {
    const invoice = sub.latest_invoice;
    if (invoice && typeof invoice !== 'string') {
      const pi = (invoice as Stripe.Invoice & { payment_intent?: unknown }).payment_intent;
      if (pi && typeof pi !== 'string') {
        return (pi as Stripe.PaymentIntent).client_secret ?? undefined;
      }
    }
    const setupIntent = sub.pending_setup_intent;
    if (setupIntent && typeof setupIntent !== 'string') {
      return (setupIntent as Stripe.SetupIntent).client_secret ?? undefined;
    }
    return undefined;
  }
}
