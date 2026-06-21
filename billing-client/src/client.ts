import axios, { AxiosInstance } from 'axios';
import {
  BillingClientConfig,
  BillingSubscription,
  CreateSubscriptionRequest,
  CreateSubscriptionResponse,
  EntityType,
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

  async addCredits(
    entityType: EntityType,
    entityId: string,
    amount: number,
    note?: string,
  ): Promise<void> {
    await this.http.post('/credits', { entityType, entityId, amount, note });
  }
}
