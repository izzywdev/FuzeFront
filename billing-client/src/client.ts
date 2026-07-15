import axios, { AxiosInstance } from 'axios';
import {
  BillingActorContext,
  BillingClientConfig,
  BillingPayment,
  BillingSubscription,
  CreateSubscriptionRequest,
  CreateSubscriptionResponse,
  EntityType,
  InvoiceListResponse,
  PaymentCheckoutRequest,
  PaymentCheckoutResponse,
  Plan,
  UpdateSubscriptionRequest,
} from './types';

const API_BASE = '/api/v1/billing';

/**
 * Typed client over the billing-service REST API. Consumed by `backend` (and
 * other internal services) to read entitlements and drive checkout. Card data
 * never flows through here — only provider ids and client secrets.
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

  async getSubscription(subscriptionId: string): Promise<BillingSubscription> {
    const res = await this.http.get<{ subscription: BillingSubscription }>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
    return res.data.subscription;
  }

  async createSubscription(req: CreateSubscriptionRequest): Promise<CreateSubscriptionResponse> {
    const res = await this.http.post<CreateSubscriptionResponse>('/subscriptions', req);
    return res.data;
  }

  async updateSubscription(
    subscriptionId: string,
    req: UpdateSubscriptionRequest,
  ): Promise<BillingSubscription> {
    const res = await this.http.patch<{ subscription: BillingSubscription }>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      req,
    );
    return res.data.subscription;
  }

  async cancelSubscription(subscriptionId: string): Promise<BillingSubscription> {
    const res = await this.http.delete<{ subscription: BillingSubscription }>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
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

  /**
   * List the authorized entity's invoices (GET /invoices), newest first, served
   * from the local invoice store. Pagination is opaque-cursor based: pass the
   * previous response's `nextCursor` as `cursor`. Actor/entity context is added
   * by the host-backend billing proxy.
   */
  async listInvoices(opts: { limit?: number; cursor?: string } = {}): Promise<InvoiceListResponse> {
    const res = await this.http.get<InvoiceListResponse>('/invoices', {
      params: {
        ...(opts.limit != null ? { limit: opts.limit } : {}),
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
      },
    });
    return res.data;
  }

  /**
   * Force a provider→store resync of the authorized entity's invoices
   * (POST /invoices/sync) and return how many were upserted. Idempotent.
   */
  async syncInvoices(): Promise<{ synced: number }> {
    const res = await this.http.post<{ synced: number }>('/invoices/sync', {});
    return res.data;
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
