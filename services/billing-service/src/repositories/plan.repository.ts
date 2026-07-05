import { Pool } from 'pg';
import { Plan, PlanTier } from '../types';

export interface PlanRepository {
  upsert(plan: Plan): Promise<void>;
  listActive(): Promise<Plan[]>;
  findByPriceId(stripePriceId: string): Promise<Plan | null>;
}

interface PlanRow {
  stripe_price_id: string;
  stripe_product_id: string;
  tier_name: PlanTier;
  display_name: string;
  billing_interval: string;
  unit_amount: number;
  currency: string;
  seat_based: boolean;
  metered_meter_name: string | null;
  features: unknown;
  is_active: boolean;
  sort_order: number;
}

function mapRow(r: PlanRow): Plan {
  return {
    stripePriceId: r.stripe_price_id,
    stripeProductId: r.stripe_product_id,
    tierName: r.tier_name,
    displayName: r.display_name,
    billingInterval: r.billing_interval,
    unitAmount: r.unit_amount,
    currency: r.currency,
    seatBased: r.seat_based,
    meteredMeterName: r.metered_meter_name,
    features: Array.isArray(r.features) ? (r.features as string[]) : [],
    isActive: r.is_active,
    sortOrder: r.sort_order,
  };
}

export class PgPlanRepository implements PlanRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(plan: Plan): Promise<void> {
    await this.pool.query(
      `INSERT INTO billing.plans
         (stripe_price_id, stripe_product_id, tier_name, display_name,
          billing_interval, unit_amount, currency, seat_based,
          metered_meter_name, features, is_active, sort_order, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (stripe_price_id) DO UPDATE SET
          stripe_product_id  = EXCLUDED.stripe_product_id,
          tier_name          = EXCLUDED.tier_name,
          display_name       = EXCLUDED.display_name,
          billing_interval   = EXCLUDED.billing_interval,
          unit_amount        = EXCLUDED.unit_amount,
          currency           = EXCLUDED.currency,
          seat_based         = EXCLUDED.seat_based,
          metered_meter_name = EXCLUDED.metered_meter_name,
          features           = EXCLUDED.features,
          is_active          = EXCLUDED.is_active,
          sort_order         = EXCLUDED.sort_order,
          synced_at          = now()`,
      [
        plan.stripePriceId,
        plan.stripeProductId,
        plan.tierName,
        plan.displayName,
        plan.billingInterval,
        plan.unitAmount,
        plan.currency,
        plan.seatBased,
        plan.meteredMeterName,
        JSON.stringify(plan.features ?? []),
        plan.isActive,
        plan.sortOrder,
      ],
    );
  }

  async listActive(): Promise<Plan[]> {
    const res = await this.pool.query<PlanRow>(
      `SELECT * FROM billing.plans WHERE is_active = TRUE ORDER BY sort_order ASC`,
    );
    return res.rows.map(mapRow);
  }

  async findByPriceId(stripePriceId: string): Promise<Plan | null> {
    const res = await this.pool.query<PlanRow>(
      `SELECT * FROM billing.plans WHERE stripe_price_id = $1`,
      [stripePriceId],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }
}
