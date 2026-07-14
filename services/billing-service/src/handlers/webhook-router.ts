import type Stripe from 'stripe';
import { HandlerContext, StripeEventHandler } from './types';
import { handleSubscriptionUpdated } from './subscription-updated';
import { handleInvoicePaid } from './invoice-paid';
import { handleInvoiceFailed } from './invoice-failed';
import { handleInvoiceSynced } from './invoice-synced';
import { handleTrialEnding } from './trial-ending';
import { handleCheckoutCompleted } from './checkout-completed';
import { handlePaymentCompleted } from './payment-completed';

/**
 * Runs the given handlers in sequence for one event. Used so an invoice event
 * BOTH persists into billing.invoices (invoice-synced) AND drives its existing
 * entitlement/notify side-effect (invoice-paid / invoice-failed).
 */
function chain(...handlers: StripeEventHandler[]): StripeEventHandler {
  return async (event, ctx) => {
    for (const handler of handlers) {
      await handler(event, ctx);
    }
  };
}

/**
 * checkout.session.completed fans out BY SESSION MODE:
 *   'subscription' (or absent — legacy)  -> the existing subscription
 *                                           activation path (unchanged)
 *   'payment'                            -> the one-time payment mirror path
 *   anything else (e.g. 'setup')         -> no-op (logged)
 */
export const dispatchCheckoutSessionCompleted: StripeEventHandler = async (
  event: Stripe.Event,
  ctx: HandlerContext,
): Promise<void> => {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode === 'payment') {
    return handlePaymentCompleted(event, ctx);
  }
  // handleCheckoutCompleted keeps its own defensive non-subscription guard.
  return handleCheckoutCompleted(event, ctx);
};

/** Maps Stripe event types to their handlers. Unmapped types are no-ops (logged). */
export const HANDLERS: Record<string, StripeEventHandler> = {
  // Hosted Checkout — subscription activation (POST /checkout) or one-time
  // payment mirror (POST /payments/checkout), dispatched by session.mode.
  'checkout.session.completed': dispatchCheckoutSessionCompleted,
  // One-time payment lifecycle (payment mode). handlePaymentCompleted ignores
  // non-payment sessions and PaymentIntents without our product metadata
  // (subscription-invoice intents stay on the invoice.payment_failed path).
  'checkout.session.expired': handlePaymentCompleted,
  'payment_intent.payment_failed': handlePaymentCompleted,
  // Subscription lifecycle. `.created` and `.updated` share the upsert path;
  // both converge with checkout.session.completed on the idempotent mirror.
  'customer.subscription.created': handleSubscriptionUpdated,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'customer.subscription.deleted': handleSubscriptionUpdated,
  'customer.subscription.trial_will_end': handleTrialEnding,
  // Invoice lifecycle: persist the invoice into billing.invoices (invoice-synced)
  // for every relevant event, and — for the succeeded/failed events — ALSO run
  // the existing entitlement/notify handler (order: persist, then notify).
  'invoice.payment_succeeded': chain(handleInvoiceSynced, handleInvoicePaid),
  'invoice.payment_failed': chain(handleInvoiceSynced, handleInvoiceFailed),
  'invoice.paid': handleInvoiceSynced,
  'invoice.finalized': handleInvoiceSynced,
  'invoice.updated': handleInvoiceSynced,
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
