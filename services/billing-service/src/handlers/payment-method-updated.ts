import type Stripe from 'stripe';
import { HandlerContext } from './types';

/**
 * Handles `payment_method.attached` (a card was added to a Customer) and
 * `payment_method.updated` (an existing card's details changed, e.g. via
 * Stripe's card updater). Emits billing.payment_method.updated so downstream
 * consumers (e.g. FuzeFinance) can refresh their own card-on-file record
 * without querying Stripe directly.
 */
export async function handlePaymentMethodUpdated(
  event: Stripe.Event,
  ctx: HandlerContext,
): Promise<void> {
  const pm = event.data.object as Stripe.PaymentMethod;
  const stripeCustomerId =
    typeof pm.customer === 'string' ? pm.customer : pm.customer?.id;
  if (!stripeCustomerId) {
    console.warn(`[payment-method-updated] payment method ${pm.id} has no customer`);
    return;
  }

  const entity = await ctx.customers.findByStripeCustomerId(stripeCustomerId);
  if (!entity) {
    console.warn(`[payment-method-updated] no local customer for ${stripeCustomerId}`);
    return;
  }

  await ctx.emitter.paymentMethodUpdated({
    entityId: entity.entityId,
    entityType: entity.entityType,
    stripeCustomerId,
    paymentMethodId: pm.id,
    brand: pm.card?.brand,
    last4: pm.card?.last4,
  });
}
