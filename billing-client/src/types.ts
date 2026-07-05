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

export interface BillingClientConfig {
  /** Base URL of billing-service, e.g. http://fuzefront-billing-service:3006 */
  baseUrl: string;
  /** BILLING_INTERNAL_TOKEN — sent as Bearer on all non-public calls. */
  internalToken: string;
  /** Optional request timeout in ms (default 10000). */
  timeoutMs?: number;
}
