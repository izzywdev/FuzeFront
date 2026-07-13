import { z } from 'zod';

/**
 * Outcome of a ONE-TIME payment-mode Checkout Session created via
 * `POST /api/v1/billing/payments/checkout` (billing-service). Emitted for all
 * three terminal outcomes — `paid` (checkout.session.completed, paid),
 * `failed` (payment_intent.payment_failed) and `expired`
 * (checkout.session.expired) — wrapped in the standard FuzeEvent envelope on
 * topic `billing.payment.completed`.
 *
 * Consumer products (e.g. `mendys-datasets`) correlate on
 * `(productKey, externalOrderId)` — their own order id, stamped on the Stripe
 * session at creation — and reconcile missed events by polling
 * `GET /payments/sessions/{stripeSessionId}`.
 */
export const billingPaymentCompletedSchemaV1 = z.object({
  /** Allowlisted consumer product key, e.g. 'mendys-datasets'. */
  productKey: z.string().min(1),
  /** The consumer product's own order id (session client_reference_id). */
  externalOrderId: z.string().min(1),
  entityType: z.enum(['user', 'organization']),
  entityId: z.string().uuid(),
  stripeSessionId: z.string().min(1),
  /** Null when Stripe never created a PaymentIntent (e.g. session expired untouched). */
  stripePaymentIntentId: z.string().nullable(),
  /** Order total in the currency's minor unit (cents). */
  amountTotalCents: z.number().int().nonnegative(),
  /** ISO 4217 currency code, lowercased. */
  currency: z.string(),
  status: z.enum(['paid', 'failed', 'expired']),
  /** ISO-8601 timestamp of the underlying Stripe event. */
  occurredAt: z.string(),
});

export type BillingPaymentCompletedPayloadV1 = z.infer<
  typeof billingPaymentCompletedSchemaV1
>;
