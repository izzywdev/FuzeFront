import type Stripe from 'stripe';
import { HandlerContext, StripeEventHandler } from './types';
import { handleSubscriptionUpdated } from './subscription-updated';
import { handleInvoicePaid } from './invoice-paid';
import { handleInvoiceFailed } from './invoice-failed';
import { handleTrialEnding } from './trial-ending';
import { handleCheckoutCompleted } from './checkout-completed';

/** Maps Stripe event types to their handlers. Unmapped types are no-ops (logged). */
export const HANDLERS: Record<string, StripeEventHandler> = {
  // Hosted-Checkout activation (POST /checkout).
  'checkout.session.completed': handleCheckoutCompleted,
  // Subscription lifecycle. `.created` and `.updated` share the upsert path;
  // both converge with checkout.session.completed on the idempotent mirror.
  'customer.subscription.created': handleSubscriptionUpdated,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'customer.subscription.deleted': handleSubscriptionUpdated,
  'customer.subscription.trial_will_end': handleTrialEnding,
  'invoice.payment_succeeded': handleInvoicePaid,
  'invoice.payment_failed': handleInvoiceFailed,
};

export async function routeWebhookEvent(
  event: Stripe.Event,
  ctx: HandlerContext,
): Promise<void> {
  const handler = HANDLERS[event.type];
  if (!handler) {
    console.info(`[webhook-router] no handler for ${event.type} (ignored)`);
    return;
  }
  await handler(event, ctx);
}
