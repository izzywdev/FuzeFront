import type Stripe from 'stripe';
import { PlanTier } from '../types';
import { SubscriptionUpsert } from '../repositories/subscription.repository';

const unixToIso = (s: number | null | undefined): string | null =>
  typeof s === 'number' ? new Date(s * 1000).toISOString() : null;

/**
 * Maps a Stripe Subscription object to the local mirror upsert shape.
 *
 * `customerId` is the *local* billing.customers PK (resolved by the caller),
 * not the Stripe customer id. `planTier` is resolved from the price id via the
 * plan cache by the caller and passed in.
 */
export function mapStripeSubscription(
  sub: Stripe.Subscription,
  args: { customerId: string; planTier: PlanTier },
): SubscriptionUpsert {
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? '';
  const seatQuantity = item?.quantity ?? 1;

  return {
    customerId: args.customerId,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    planTier: args.planTier,
    status: sub.status,
    seatQuantity,
    trialStart: unixToIso(sub.trial_start),
    trialEnd: unixToIso(sub.trial_end),
    currentPeriodStart: unixToIso(sub.current_period_start),
    currentPeriodEnd: unixToIso(sub.current_period_end),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    canceledAt: unixToIso(sub.canceled_at),
  };
}
