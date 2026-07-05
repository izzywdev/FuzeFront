import type Stripe from 'stripe';
import { HandlerContext } from './types';

/**
 * Handles `invoice.payment_failed` (dunning): mark the entity `past_due`, sync
 * Permit + cache, and emit billing.payment.failed so email-service can notify.
 * Stripe Smart Retries handle the actual retry schedule; final failure arrives
 * as customer.subscription.deleted (handled separately → downgrade to free).
 */
export async function handleInvoiceFailed(
  event: Stripe.Event,
  ctx: HandlerContext,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const stripeCustomerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!stripeCustomerId) return;

  const entity = await ctx.customers.findByStripeCustomerId(stripeCustomerId);
  if (!entity) {
    console.warn(`[invoice-failed] no local customer for ${stripeCustomerId}`);
    return;
  }

  const existing = await ctx.subscriptions.findByCustomer(entity.id);
  const planTier = existing?.planTier ?? 'unknown';

  await ctx.permit.syncPlanToPermit({
    entityType: entity.entityType,
    entityId: entity.entityId,
    planTier,
    status: 'past_due',
  });

  await ctx.writePlanCache({
    entityType: entity.entityType,
    entityId: entity.entityId,
    planTier,
    status: 'past_due',
    trialEnd: existing?.trialEnd ?? null,
  });

  await ctx.emitter.paymentFailed({
    entityId: entity.entityId,
    entityType: entity.entityType,
    invoiceId: invoice.id ?? '',
    amountDue: invoice.amount_due ?? 0,
    currency: invoice.currency ?? 'usd',
  });
}
