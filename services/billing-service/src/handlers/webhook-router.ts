import type Stripe from 'stripe';
import { HandlerContext, StripeEventHandler } from './types';
import { handleSubscriptionUpdated } from './subscription-updated';
import { handleInvoicePaid } from './invoice-paid';
import { handleInvoiceFailed } from './invoice-failed';
import { handleTrialEnding } from './trial-ending';

/** Maps Stripe event types to their handlers. Unmapped types are no-ops (logged). */
export const HANDLERS: Record<string, StripeEventHandler> = {
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
