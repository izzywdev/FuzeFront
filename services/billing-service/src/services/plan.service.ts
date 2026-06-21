import type Stripe from 'stripe';
import { Plan, PlanTier } from '../types';
import { PlanRepository } from '../repositories/plan.repository';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per spec

/**
 * Syncs the Stripe product/price catalogue into the local billing.plans read
 * cache and serves the active plan list with an in-memory TTL cache.
 *
 * Source of truth is Stripe; billing.plans is a denormalised read model so the
 * public GET /plans endpoint never hits the Stripe API on the hot path.
 */
export class PlanService {
  private cache: { at: number; plans: Plan[] } | null = null;

  constructor(
    private readonly stripe: Pick<Stripe, 'prices'>,
    private readonly repo: PlanRepository,
    private readonly ttlMs: number = DEFAULT_CACHE_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Pulls active Stripe prices (with expanded product) into billing.plans. */
  async syncPlans(): Promise<number> {
    const result = await this.stripe.prices.list({
      active: true,
      expand: ['data.product'],
      limit: 100,
    });

    let count = 0;
    for (const price of result.data) {
      const product = price.product as Stripe.Product;
      const md = product.metadata ?? {};
      const plan: Plan = {
        stripePriceId: price.id,
        stripeProductId: typeof price.product === 'string' ? price.product : product.id,
        tierName: (md.tier_name as PlanTier) || product.name || 'unknown',
        displayName: product.name || md.tier_name || price.id,
        billingInterval: price.recurring?.interval ?? 'month',
        unitAmount: price.unit_amount ?? 0,
        currency: price.currency ?? 'usd',
        seatBased: md.seat_based === 'true',
        meteredMeterName:
          price.recurring?.usage_type === 'metered'
            ? (md.meter_name as string) || null
            : null,
        features: this.parseFeatures(md.features),
        isActive: price.active !== false,
        sortOrder: Number.parseInt(md.sort_order ?? '0', 10) || 0,
      };
      await this.repo.upsert(plan);
      count++;
    }

    // Invalidate the read cache so getActivePlans reflects the fresh sync.
    this.cache = null;
    return count;
  }

  /** Returns active plans from the local cache, refreshing from the repo on TTL miss. */
  async getActivePlans(): Promise<Plan[]> {
    if (this.cache && this.now() - this.cache.at < this.ttlMs) {
      return this.cache.plans;
    }
    const plans = await this.repo.listActive();
    this.cache = { at: this.now(), plans };
    return plans;
  }

  private parseFeatures(raw: string | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      // Allow a comma-separated fallback in Stripe metadata.
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
}
