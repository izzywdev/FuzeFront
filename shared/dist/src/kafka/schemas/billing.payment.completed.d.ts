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
export declare const billingPaymentCompletedSchemaV1: any;
export type BillingPaymentCompletedPayloadV1 = z.infer<typeof billingPaymentCompletedSchemaV1>;
