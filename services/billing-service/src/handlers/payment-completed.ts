import type Stripe from 'stripe';
import { HandlerContext } from './types';
import { PaymentStatus } from '../types';
import { paymentStatusFromSession } from '../routes/payments';

/**
 * Handles the ONE-TIME payment-mode Checkout lifecycle (POST /payments/checkout):
 *
 *   checkout.session.completed   (mode 'payment')  -> 'paid' (when paid)
 *   checkout.session.expired     (mode 'payment')  -> 'expired'
 *   payment_intent.payment_failed                  -> 'failed'
 *
 * Each event upserts the billing.payments mirror and — for the three terminal
 * outcomes — emits `billing.payment.completed` on Kafka so the owning consumer
 * product (metadata { productKey, externalOrderId }, stamped at session
 * creation) can fulfil/release the order.
 *
 * Idempotency is handled upstream (EventRepository.recordIfNew); the mirror
 * upsert is itself idempotent (ON CONFLICT (stripe_session_id)) and never
 * downgrades a 'paid' row (see PgPaymentRepository).
 *
 * NOTE on payment_intent.payment_failed: PaymentIntents are ALSO created by
 * subscription invoices — we only treat an intent as ours when it carries the
 * { productKey, externalOrderId } metadata we stamped via payment_intent_data.
 * Subscription payment failures stay on the invoice.payment_failed path.
 */
export async function handlePaymentCompleted(
  event: Stripe.Event,
  ctx: HandlerContext,
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.expired':
      return handleSessionEvent(event, ctx);
    case 'payment_intent.payment_failed':
      return handleIntentFailed(event, ctx);
    default:
      console.info(`[payment-completed] unexpected event type ${event.type} (ignored)`);
      return;
  }
}

async function handleSessionEvent(event: Stripe.Event, ctx: HandlerContext): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  if (session.mode !== 'payment') {
    console.info(`[payment-completed] ignoring non-payment session ${session.id}`);
    return;
  }

  const productKey = session.metadata?.productKey;
  const externalOrderId = session.metadata?.externalOrderId ?? session.client_reference_id;
  if (!productKey || !externalOrderId) {
    // Not created via POST /payments/checkout (some other integration).
    console.warn(
      `[payment-completed] session ${session.id} lacks productKey/externalOrderId metadata — skipping`,
    );
    return;
  }

  const status: PaymentStatus =
    event.type === 'checkout.session.expired' ? 'expired' : paymentStatusFromSession(session);

  // Resolve the paying entity: prefer the mirror row the route wrote at
  // session creation; fall back to the local Stripe-customer mapping.
  const existing = await ctx.payments.getBySessionId(session.id);
  let entityType = existing?.entityType;
  let entityId = existing?.entityId;
  if (!entityType || !entityId) {
    const stripeCustomerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const entity = stripeCustomerId
      ? await ctx.customers.findByStripeCustomerId(stripeCustomerId)
      : null;
    if (!entity) {
      console.warn(`[payment-completed] no local entity for session ${session.id} — skipping`);
      return;
    }
    entityType = entity.entityType;
    entityId = entity.entityId;
  }

  const row = await ctx.payments.upsert({
    stripeSessionId: session.id,
    stripePaymentIntentId:
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? existing?.stripePaymentIntentId ?? null,
    productKey,
    externalOrderId,
    entityType,
    entityId,
    amountTotalCents: session.amount_total ?? existing?.amountTotalCents ?? 0,
    currency: (session.currency ?? existing?.currency ?? '').toLowerCase(),
    status,
  });

  // A completed-but-unpaid session (async payment method still settling) is
  // mirrored as 'pending' and NOT emitted — the follow-up webhook decides.
  if (status === 'pending') {
    console.info(`[payment-completed] session ${session.id} not paid yet — mirror updated only`);
    return;
  }

  await ctx.emitter.paymentCompleted({
    productKey: row.productKey,
    externalOrderId: row.externalOrderId,
    entityType: row.entityType,
    entityId: row.entityId,
    stripeSessionId: row.stripeSessionId,
    stripePaymentIntentId: row.stripePaymentIntentId,
    amountTotalCents: row.amountTotalCents,
    currency: row.currency,
    status: status as 'paid' | 'expired',
    occurredAt: new Date(event.created * 1000).toISOString(),
  });
}

async function handleIntentFailed(event: Stripe.Event, ctx: HandlerContext): Promise<void> {
  const intent = event.data.object as Stripe.PaymentIntent;

  const productKey = intent.metadata?.productKey;
  const externalOrderId = intent.metadata?.externalOrderId;
  if (!productKey || !externalOrderId) {
    // A subscription-invoice (or foreign) PaymentIntent — not ours to handle.
    console.info(
      `[payment-completed] payment_intent ${intent.id} has no product metadata (ignored)`,
    );
    return;
  }

  // The PaymentIntent event carries no session id; correlate through the
  // mirror row the route wrote at session creation.
  const existing = await ctx.payments.findByOrder(productKey, externalOrderId);
  if (!existing) {
    console.warn(
      `[payment-completed] no mirror row for ${productKey}/${externalOrderId} (intent ${intent.id}) — skipping`,
    );
    return;
  }

  const row = await ctx.payments.upsert({
    ...toUpsert(existing),
    stripePaymentIntentId: intent.id,
    status: 'failed',
  });

  // The repository never downgrades a 'paid' row; if the failure raced a
  // success (buyer retried in-session), do not emit a stale 'failed'.
  if (row.status !== 'failed') {
    console.info(
      `[payment-completed] session ${row.stripeSessionId} already ${row.status} — failed event superseded`,
    );
    return;
  }

  await ctx.emitter.paymentCompleted({
    productKey: row.productKey,
    externalOrderId: row.externalOrderId,
    entityType: row.entityType,
    entityId: row.entityId,
    stripeSessionId: row.stripeSessionId,
    stripePaymentIntentId: row.stripePaymentIntentId,
    amountTotalCents: row.amountTotalCents,
    currency: row.currency,
    status: 'failed',
    occurredAt: new Date(event.created * 1000).toISOString(),
  });
}

function toUpsert(row: {
  stripeSessionId: string;
  stripePaymentIntentId: string | null;
  productKey: string;
  externalOrderId: string;
  entityType: 'user' | 'organization';
  entityId: string;
  amountTotalCents: number;
  currency: string;
  status: PaymentStatus;
}) {
  return {
    stripeSessionId: row.stripeSessionId,
    stripePaymentIntentId: row.stripePaymentIntentId,
    productKey: row.productKey,
    externalOrderId: row.externalOrderId,
    entityType: row.entityType,
    entityId: row.entityId,
    amountTotalCents: row.amountTotalCents,
    currency: row.currency,
    status: row.status,
  };
}
