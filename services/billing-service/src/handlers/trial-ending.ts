import type Stripe from 'stripe';
import { HandlerContext } from './types';

/**
 * Handles `customer.subscription.trial_will_end` (Stripe fires ~3 days before
 * trial end): emit billing.trial.ending so email-service sends a reminder.
 */
export async function handleTrialEnding(
  event: Stripe.Event,
  ctx: HandlerContext,
): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const stripeCustomerId =
    typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  const entity = await ctx.customers.findByStripeCustomerId(stripeCustomerId);
  if (!entity) {
    console.warn(`[trial-ending] no local customer for ${stripeCustomerId}`);
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id ?? '';
  const plan = priceId ? await ctx.plans.findByPriceId(priceId) : null;

  await ctx.emitter.trialEnding({
    entityId: entity.entityId,
    entityType: entity.entityType,
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : '',
    planTier: plan?.tierName ?? 'unknown',
  });
}
