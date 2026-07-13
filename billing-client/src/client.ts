import axios, { AxiosInstance } from 'axios';
import {
  BillingActorContext,
  BillingClientConfig,
  BillingPayment,
  BillingSubscription,
  CreateSubscriptionRequest,
  CreateSubscriptionResponse,
  EntityType,
  PaymentCheckoutRequest,
  PaymentCheckoutResponse,
  Plan,
  UpdateSubscriptionRequest,
} from './types';

const API_BASE = '/api/v1/billing';

/**
 * Typed client over the billing-service REST API. Consumed by `backend` (and
 * other internal services) to read entitlements and drive checkout. Card data
 * never flows through here — only Stripe ids and client secrets.
 */
export class BillingClient {
  private readonly http: AxiosInstance;

  constructor(config: BillingClientConfig) {
    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/$/, '') + API_BASE,
      timeout: config.timeoutMs ?? 10_000,
      headers: { Authorization: `Bearer ${config.internalToken}` },
    });
  }

  async getPlans(): Promise<Plan[]> {
    const res = await this.http.get<{ plans: Plan[] }>('/plans');
    return res.data.plans;
  }

  async getSubscription(stripeSubscriptionId: string): Promise<BillingSubscription> {
    const res = await this.http.get<{ subscription: BillingSubscription }>(
      `/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
    );
    return res.data.subscription;
  }

  async createSubscription(req: CreateSubscriptionRequest): Promise<CreateSubscriptionResponse> {
    const res = await this.http.post<CreateSubscriptionResponse>('/subscriptions', req);
    return res.data;
  }

  async updateSubscription(
    stripeSubscriptionId: string,
    req: UpdateSubscriptionRequest,
  ): Promise<BillingSubscription> {
    const res = await this.http.patch<{ subscription: BillingSubscription }>(
      `/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
      req,
    );
    return res.data.subscription;
  }

  async cancelSubscription(stripeSubscriptionId: string): Promise<BillingSubscription> {
    const res = await this.http.delete<{ subscription: BillingSubscription }>(
      `/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
    );
    return res.data.subscription;
  }

  async createSetupIntent(
    entityType: EntityType,
    entityId: string,
  ): Promise<{ clientSecret: string }> {
    const res = await this.http.post<{ clientSecret: string }>('/setup-intent', {
      entityType,
      entityId,
    });
    return res.data;
  }

  async createPaymentCheckout(
    req: PaymentCheckoutRequest,
    actor?: BillingActorContext,
  ): Promise<PaymentCheckoutResponse> {
    const res = await this.http.post<PaymentCheckoutResponse>('/payments/checkout', req, {
      headers: actorHeaders(actor),
    });
    return res.data;
  }

  async getPaymentSession(
    sessionId: string,
    actor?: BillingActorContext,
  ): Promise<BillingPayment> {
    const res = await this.http.get<{ payment: BillingPayment }>(
      `/payments/sessions/${encodeURIComponent(sessionId)}`,
      { headers: actorHeaders(actor) },
    );
    return res.data.payment;
  }

  async addCredits(
    entityType: EntityType,
    entityId: string,
    amount: number,
    note?: string,
  ): Promise<void> {
    await this.http.post('/credits', { entityType, entityId, amount, note });
  }
}

/**
 * Maps the optional actor context to the billing-service's trusted headers.
 * The host-backend billing proxy injects these itself; direct internal callers
 * (e.g. a consumer product's backend) pass `actor` explicitly — the payments
 * routes reject requests without it (401) or with a mismatched entity (403).
 */
function actorHeaders(actor?: BillingActorContext): Record<string, string> {
  if (!actor) return {};
  return {
    'X-Billing-Actor-User-Id': actor.actorUserId,
    'X-Billing-Entity-Type': actor.entityType,
    'X-Billing-Entity-Id': actor.entityId,
  };
}
