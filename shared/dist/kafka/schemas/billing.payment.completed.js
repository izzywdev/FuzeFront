"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingPaymentCompletedSchemaV1 = void 0;
const zod_1 = require("zod");
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
exports.billingPaymentCompletedSchemaV1 = zod_1.z.object({
    /** Allowlisted consumer product key, e.g. 'mendys-datasets'. */
    productKey: zod_1.z.string().min(1),
    /** The consumer product's own order id (session client_reference_id). */
    externalOrderId: zod_1.z.string().min(1),
    entityType: zod_1.z.enum(['user', 'organization']),
    entityId: zod_1.z.string().uuid(),
    stripeSessionId: zod_1.z.string().min(1),
    /** Null when Stripe never created a PaymentIntent (e.g. session expired untouched). */
    stripePaymentIntentId: zod_1.z.string().nullable(),
    /** Order total in the currency's minor unit (cents). */
    amountTotalCents: zod_1.z.number().int().nonnegative(),
    /** ISO 4217 currency code, lowercased. */
    currency: zod_1.z.string(),
    status: zod_1.z.enum(['paid', 'failed', 'expired']),
    /** ISO-8601 timestamp of the underlying Stripe event. */
    occurredAt: zod_1.z.string(),
});
