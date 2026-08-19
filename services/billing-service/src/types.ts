/**
 * Internal domain types shared across billing-service services, routes, and
 * handlers. The public client-facing types live in `@fuzefront/billing-client`.
 */

export type EntityType = 'user' | 'organization';

export interface BillingCustomer {
  id: string;
  entityType: EntityType;
  entityId: string;
  stripeCustomerId: string;
}

/**
 * Lifecycle of a payment-mode Checkout mirror row: 'pending' from session
 * creation until a webhook lands, then 'paid' / 'failed' / 'expired'.
 * 'paid' is terminal (never downgraded — see PgPaymentRepository.upsert).
 */
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';

/** Local mirror of a ONE-TIME payment-mode hosted Checkout Session. */
export interface BillingPayment {
  id: string;
  sessionId: string;
  paymentIntentId: string | null;
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

export type PlanTier = 'free' | 'starter' | 'pro' | 'enterprise' | string;

/** Mirrors Stripe subscription status enum values. */
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
  subscriptionId: string;
  priceId: string;
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
  priceId: string;
  productId: string;
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
  /** Start a no-card trial (Stripe trial_period_days). */
  trial?: boolean;
  trialPeriodDays?: number;
  /** Seat quantity for per-seat plans. Defaults to 1. */
  seatQuantity?: number;
  /** Existing Stripe PaymentMethod to attach (omit for no-card trials). */
  paymentMethodId?: string;
}

export interface CreateSubscriptionResponse {
  subscription: BillingSubscription;
  /** Set when Stripe needs SCA/3DS confirmation on the client. */
  clientSecret?: string;
  requiresAction: boolean;
}

export interface UpdateSubscriptionRequest {
  /** New price (plan change). */
  priceId?: string;
  /** New seat quantity. */
  seatQuantity?: number;
}
