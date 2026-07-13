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
export declare const billingPaymentCompletedSchemaV1: z.ZodObject<{
    /** Allowlisted consumer product key, e.g. 'mendys-datasets'. */
    productKey: z.ZodString;
    /** The consumer product's own order id (session client_reference_id). */
    externalOrderId: z.ZodString;
    entityType: z.ZodEnum<["user", "organization"]>;
    entityId: z.ZodString;
    stripeSessionId: z.ZodString;
    /** Null when Stripe never created a PaymentIntent (e.g. session expired untouched). */
    stripePaymentIntentId: z.ZodNullable<z.ZodString>;
    /** Order total in the currency's minor unit (cents). */
    amountTotalCents: z.ZodNumber;
    /** ISO 4217 currency code, lowercased. */
    currency: z.ZodString;
    status: z.ZodEnum<["paid", "failed", "expired"]>;
    /** ISO-8601 timestamp of the underlying Stripe event. */
    occurredAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "paid" | "failed" | "expired";
    productKey: string;
    externalOrderId: string;
    entityType: "user" | "organization";
    entityId: string;
    stripeSessionId: string;
    stripePaymentIntentId: string | null;
    amountTotalCents: number;
    currency: string;
    occurredAt: string;
}, {
    status: "paid" | "failed" | "expired";
    productKey: string;
    externalOrderId: string;
    entityType: "user" | "organization";
    entityId: string;
    stripeSessionId: string;
    stripePaymentIntentId: string | null;
    amountTotalCents: number;
    currency: string;
    occurredAt: string;
}>;
export type BillingPaymentCompletedPayloadV1 = z.infer<typeof billingPaymentCompletedSchemaV1>;
