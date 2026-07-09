import type Stripe from 'stripe';
import { HandlerContext } from './types';
import { mapStripeSubscription } from '../services/subscription.mapper';
import { EntityType } from '../types';

/**
 * Handles `customer.subscription.updated` and `customer.subscription.deleted`.
 *
 *  1. Resolve the local customer + entity from the Stripe customer id.
 *  2. Map status: a `deleted` event downgrades the entity to the free tier.
 *  3. Upsert the local subscription mirror (billing schema only).
 *  4. Sync the plan to Permit.
 *  5. Emit billing.subscription.changed (the backend projects this onto
 *     public.users/organizations — billing-service never writes those tables).
 */
export async function handleSubscriptionUpdated(
  event: Stripe.Event,
  ctx: HandlerContext,
): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const stripeCustomerId =
    typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  const entity = await resolveEntity(ctx, stripeCustomerId);
  if (!entity) {
    console.warn(`[subscription-updated] no local customer for ${stripeCustomerId}`);
    return;
  }

  const isDeleted = event.type === 'customer.subscription.deleted';
  const priceId = sub.items?.data?.[0]?.price?.id ?? '';
  const plan = priceId ? await ctx.plans.findByPriceId(priceId) : null;
  const planTier = isDeleted ? 'free' : plan?.tierName ?? 'unknown';
  const status = isDeleted ? 'canceled' : sub.status;
  const seatQuantity = sub.items?.data?.[0]?.quantity ?? undefined;

  await ctx.subscriptions.upsert(
    mapStripeSubscription({ ...sub, status } as Stripe.Subscription, {
      customerId: entity.customerLocalId,
      planTier,
    }),
  );

  await ctx.permit.syncPlanToPermit({
    entityType: entity.entityType,
    entityId: entity.entityId,
    planTier,
    status,
    seatQuantity,
  });

  // NOTE: we deliberately do NOT write public.users/organizations here.
  // billing-service owns only the `billing` schema; the backend maintains the
  // public plan-state projection by consuming the event emitted below.
  await ctx.emitter.subscriptionChanged({
    entityId: entity.entityId,
    entityType: entity.entityType,
    planTier,
    status,
    seatQuantity,
    stripeSubscriptionId: sub.id,
  });
}

async function resolveEntity(
  ctx: HandlerContext,
  stripeCustomerId: string,
): Promise<{ customerLocalId: string; entityType: EntityType; entityId: string } | null> {
  const found = await ctx.customers.findByStripeCustomerId(stripeCustomerId);
  if (!found) return null;
  return {
    customerLocalId: found.id,
    entityType: found.entityType,
    entityId: found.entityId,
  };
}
