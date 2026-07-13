export type EntityType = 'user' | 'organization';

export type PlanTier = 'free' | 'starter' | 'pro' | 'enterprise' | string;

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | string;

export interface BillingSubscription {
  id: string;
  customerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  planTier: PlanTier;
  status: SubscriptionStatus;
  seatQuantity: number;
  trialStart: string | null;
  trialEnd: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
}

export interface Plan {
  stripePriceId: string;
  stripeProductId: string;
  tierName: PlanTier;
  displayName: string;
  billingInterval: 'month' | 'year' | string;
  unitAmount: number;
  currency: string;
  seatBased: boolean;
  meteredMeterName: string | null;
  features: string[];
  isActive: boolean;
  sortOrder: number;
}

export interface CreateSubscriptionRequest {
  entityType: EntityType;
  entityId: string;
  priceId: string;
  trial?: boolean;
  trialPeriodDays?: number;
  seatQuantity?: number;
  paymentMethodId?: string;
}

export interface CreateSubscriptionResponse {
  subscription: BillingSubscription;
  clientSecret?: string;
  requiresAction: boolean;
}

export interface UpdateSubscriptionRequest {
  priceId?: string;
  seatQuantity?: number;
}

/**
 * Lifecycle of a payment-mode Checkout mirror row: `pending` from session
 * creation until a webhook lands, then `paid` / `failed` / `expired`
 * (`paid` is terminal — never downgraded).
 */
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';

export interface PaymentLineItem {
  /** Line-item display name shown on the Stripe-hosted page. */
  name: string;
  /** Optional line-item description shown under the name. */
  description?: string;
  /** Unit price in the currency's minor unit (cents); bounded server-side. */
  unitAmountCents: number;
  /** Units of this line item. */
  quantity: number;
}

export interface PaymentCheckoutRequest {
  /** Allowlisted consumer product key (BILLING_PRODUCT_KEYS), e.g. 'mendys-datasets'. */
  productKey: string;
  /** The consumer product's own order id (stamped as client_reference_id + metadata). */
  externalOrderId: string;
  /** Paying entity — must match the proxy-authorized entity (403 otherwise). */
  entityType: EntityType;
  entityId: string;
  /** ISO 4217 code (case-insensitive; allowlisted server-side, default usd/eur). */
  currency: string;
  lineItems: PaymentLineItem[];
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentCheckoutResponse {
  /** The Stripe Checkout Session id (`cs_...`). */
  sessionId: string;
  /** Stripe-hosted Checkout URL to redirect the buyer to. */
  url: string | null;
}

/** Local billing.payments mirror of a one-time payment-mode Checkout Session. */
export interface BillingPayment {
  id: string;
  stripeSessionId: string;
  stripePaymentIntentId: string | null;
  productKey: string;
  externalOrderId: string;
  entityType: EntityType;
  entityId: string;
  amountTotalCents: number;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * The SERVER-DERIVED actor/entity context the billing-service's money routes
 * require. When calls go through the host-backend billing proxy these headers
 * are injected there; an internal service calling billing-service directly
 * (with its own BILLING_INTERNAL_TOKEN) must supply them itself.
 */
export interface BillingActorContext {
  /** Authenticated platform user id -> X-Billing-Actor-User-Id. */
  actorUserId: string;
  /** Authorized entity type -> X-Billing-Entity-Type. */
  entityType: EntityType;
  /** Authorized entity id -> X-Billing-Entity-Id. */
  entityId: string;
}

export interface BillingClientConfig {
  /** Base URL of billing-service, e.g. http://fuzefront-billing-service:3006 */
  baseUrl: string;
  /** BILLING_INTERNAL_TOKEN — sent as Bearer on all non-public calls. */
  internalToken: string;
  /** Optional request timeout in ms (default 10000). */
  timeoutMs?: number;
}
