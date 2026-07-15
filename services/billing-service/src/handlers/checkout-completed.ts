import type Stripe from 'stripe';
import { HandlerContext } from './types';
import { mapStripeSubscription } from '../services/subscription.mapper';

/**
 * Handles `checkout.session.completed` for the hosted-Checkout subscription
 * flow (POST /checkout). When a customer completes the Stripe-hosted card form,
 * Stripe fires this event; we activate the local subscription mirror.
 *
 * Flow:
 *  1. Ignore non-subscription / unpaid sessions (defensive — we only create
 *     subscription-mode sessions, but other integrations might exist).
 *  2. Resolve the local customer from the Stripe customer id on the session.
 *  3. Retrieve the full Stripe Subscription (the session only has its id) so we
 *     can mirror price / status / periods, then upsert the mirror.
 *  4. Resolve the plan tier from the price, sync Permit + the hot-path cache,
 *     and emit billing.subscription.changed.
 *
 * Idempotency is handled upstream (EventRepository.recordIfNew); the mirror
 * upsert is itself idempotent (ON CONFLICT (stripe_subscription_id)).
 *
 * NOTE: `customer.subscription.created` / `.updated` are ALSO handled
 * (handleSubscriptionUpdated) and may arrive before/after this event; both
 * converge on the same idempotent upsert, so ordering does not matter.
 */
export async function handleCheckoutCompleted(
  event: Stripe.Event,
  ctx: HandlerContext,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  if (session.mode && session.mode !== 'subscription') {
    console.info(`[checkout-completed] ignoring non-subscription session ${session.id}`);
    return;
  }
  // Only activate on a paid/complete session.
  if (session.payment_status && session.payment_status === 'unpaid') {
    console.info(`[checkout-completed] session ${session.id} not paid yet — skipping`);
    return;
  }

  const stripeCustomerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (!stripeCustomerId) {
    console.warn(`[checkout-completed] session ${session.id} has no customer`);
    return;
  }

  const entity = await ctx.customers.findByStripeCustomerId(stripeCustomerId);
  if (!entity) {
    console.warn(`[checkout-completed] no local customer for ${stripeCustomerId}`);
    return;
  }

  const stripeSubscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;
  if (!stripeSubscriptionId) {
    console.warn(`[checkout-completed] session ${session.id} has no subscription`);
    return;
  }

  // Retrieve the full subscription so the mirror reflects real price/periods.
  // If no retriever is wired (degraded), fall back to a minimal activation so
  // the entity is still entitled.
  let sub: Stripe.Subscription | null = null;
  if (ctx.retrieveSubscription) {
    try {
      sub = await ctx.retrieveSubscription(stripeSubscriptionId);
    } catch (err) {
      console.error(
        `[checkout-completed] failed to retrieve ${stripeSubscriptionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const priceId = sub?.items?.data?.[0]?.price?.id ?? '';
  const plan = priceId ? await ctx.plans.findByPriceId(priceId) : null;
  const planTier = plan?.tierName ?? 'unknown';
  const status = sub?.status ?? 'active';
  const seatQuantity = sub?.items?.data?.[0]?.quantity ?? 1;

  await ctx.subscriptions.upsert(
    sub
      ? mapStripeSubscription(sub, { customerId: entity.id, planTier })
      : {
          customerId: entity.id,
          subscriptionId: stripeSubscriptionId,
          priceId: priceId,
          planTier,
          status,
          seatQuantity,
          trialStart: null,
          trialEnd: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
        },
  );

  await ctx.permit.syncPlanToPermit({
    entityType: entity.entityType,
    entityId: entity.entityId,
    planTier,
    status,
    seatQuantity,
  });

  await ctx.writePlanCache({
    entityType: entity.entityType,
    entityId: entity.entityId,
    planTier,
    status,
    trialEnd: sub?.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
  });

  await ctx.emitter.subscriptionChanged({
    entityId: entity.entityId,
    entityType: entity.entityType,
    planTier,
    status,
    seatQuantity,
    stripeSubscriptionId,
  });
}
