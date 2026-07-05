import type Stripe from 'stripe';
import { HandlerContext } from './types';

/**
 * Handles `invoice.payment_succeeded`: a successful charge moves the entity
 * back to `active` (e.g. recovering from past_due) and refreshes Permit + cache.
 */
export async function handleInvoicePaid(
  event: Stripe.Event,
  ctx: HandlerContext,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const stripeCustomerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!stripeCustomerId) return;

  const entity = await ctx.customers.findByStripeCustomerId(stripeCustomerId);
  if (!entity) {
    console.warn(`[invoice-paid] no local customer for ${stripeCustomerId}`);
    return;
  }

  const existing = await ctx.subscriptions.findByCustomer(entity.id);
  const planTier = existing?.planTier ?? 'unknown';

  await ctx.permit.syncPlanToPermit({
    entityType: entity.entityType,
    entityId: entity.entityId,
    planTier,
    status: 'active',
  });

  await ctx.writePlanCache({
    entityType: entity.entityType,
    entityId: entity.entityId,
    planTier,
    status: 'active',
    trialEnd: existing?.trialEnd ?? null,
  });

  await ctx.emitter.subscriptionChanged({
    entityId: entity.entityId,
    entityType: entity.entityType,
    planTier,
    status: 'active',
    stripeSubscriptionId: existing?.stripeSubscriptionId ?? '',
  });
}
