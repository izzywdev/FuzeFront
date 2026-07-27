import type Stripe from 'stripe';
import { Plan, PlanTier } from '../types';
import { PlanRepository } from '../repositories/plan.repository';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per spec

/**
 * Static plan-id → Stripe price mapping for the hosted-Checkout flow.
 *
 * The Stripe catalogue (synced into billing.plans) is keyed by price id /
 * tierName; the public /checkout contract takes a friendlier `planId`. This map
 * bridges the two. `basic` is the LIVE $9/mo price used for the live-charge
 * demo. A resolved price is ALWAYS re-validated against the active catalogue
 * (`getActivePlans`) before use so a stale/disabled price can never be charged
 * (MEDIUM-1).
 */
export const PLAN_ID_TO_PRICE_ID: Record<string, string> = {
  basic: 'price_1TnCqVDaNn3aKLEz05TbFbFQ',
};

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

  /**
   * Resolves a public `planId` to a Stripe price id for Checkout, validating
   * the result against the active plan catalogue (MEDIUM-1). The planId may be:
   *   - a known logical plan id in PLAN_ID_TO_PRICE_ID (e.g. 'basic'),
   *   - a tier name present in the active catalogue (e.g. 'starter'), or
   *   - a Stripe price id that is present + active in the catalogue.
   *
   * Throws when the plan is unknown or maps to an inactive/absent price — the
   * caller turns that into a 400, so an attacker can never drive a checkout for
   * an arbitrary/disabled price.
   */
  async resolvePriceId(planId: string): Promise<string> {
    const active = await this.getActivePlans();

    // 1) Logical plan id mapping (e.g. 'basic' -> the live $9/mo price).
    const mapped = PLAN_ID_TO_PRICE_ID[planId.toLowerCase()];
    const candidate = mapped ?? planId;

    // 2) Accept the candidate only if it is an active price OR an active tier.
    const byPrice = active.find((p) => p.stripePriceId === candidate && p.isActive);
    if (byPrice) return byPrice.stripePriceId;

    const byTier = active.find((p) => p.tierName === candidate && p.isActive);
    if (byTier) return byTier.stripePriceId;

    // 3) Allow the configured 'basic' live price even before a catalogue sync
    //    has populated it (the live-charge demo path), but never an arbitrary
    //    client-supplied price id.
    if (mapped) return mapped;

    throw new Error(`unknown or inactive plan: ${planId}`);
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
