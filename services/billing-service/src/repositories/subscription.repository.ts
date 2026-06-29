import { Pool } from 'pg';
import { BillingSubscription, PlanTier, SubscriptionStatus } from '../types';

export interface SubscriptionUpsert {
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

export interface SubscriptionRepository {
  upsert(row: SubscriptionUpsert): Promise<BillingSubscription>;
  findByStripeId(stripeSubscriptionId: string): Promise<BillingSubscription | null>;
  /** Most-recent (current) subscription for a customer, or null. */
  findByCustomer(customerId: string): Promise<BillingSubscription | null>;
}

interface SubRow {
  id: string;
  customer_id: string;
  stripe_subscription_id: string;
  stripe_price_id: string;
  plan_tier: PlanTier;
  status: SubscriptionStatus;
  seat_quantity: number;
  trial_start: Date | null;
  trial_end: Date | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
}

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

function mapRow(r: SubRow): BillingSubscription {
  return {
    id: r.id,
    customerId: r.customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    stripePriceId: r.stripe_price_id,
    planTier: r.plan_tier,
    status: r.status,
    seatQuantity: r.seat_quantity,
    trialStart: iso(r.trial_start),
    trialEnd: iso(r.trial_end),
    currentPeriodStart: iso(r.current_period_start),
    currentPeriodEnd: iso(r.current_period_end),
    cancelAtPeriodEnd: r.cancel_at_period_end,
    canceledAt: iso(r.canceled_at),
  };
}

export class PgSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(row: SubscriptionUpsert): Promise<BillingSubscription> {
    const res = await this.pool.query<SubRow>(
      `INSERT INTO billing.subscriptions
         (customer_id, stripe_subscription_id, stripe_price_id, plan_tier, status,
          seat_quantity, trial_start, trial_end, current_period_start,
          current_period_end, cancel_at_period_end, canceled_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (stripe_subscription_id) DO UPDATE SET
          stripe_price_id      = EXCLUDED.stripe_price_id,
          plan_tier            = EXCLUDED.plan_tier,
          status               = EXCLUDED.status,
          seat_quantity        = EXCLUDED.seat_quantity,
          trial_start          = EXCLUDED.trial_start,
          trial_end            = EXCLUDED.trial_end,
          current_period_start = EXCLUDED.current_period_start,
          current_period_end   = EXCLUDED.current_period_end,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          canceled_at          = EXCLUDED.canceled_at,
          updated_at           = now()
       RETURNING *`,
      [
        row.customerId,
        row.stripeSubscriptionId,
        row.stripePriceId,
        row.planTier,
        row.status,
        row.seatQuantity,
        row.trialStart,
        row.trialEnd,
        row.currentPeriodStart,
        row.currentPeriodEnd,
        row.cancelAtPeriodEnd,
        row.canceledAt,
      ],
    );
    return mapRow(res.rows[0]);
  }

  async findByStripeId(stripeSubscriptionId: string): Promise<BillingSubscription | null> {
    const res = await this.pool.query<SubRow>(
      `SELECT * FROM billing.subscriptions WHERE stripe_subscription_id = $1`,
      [stripeSubscriptionId],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async findByCustomer(customerId: string): Promise<BillingSubscription | null> {
    const res = await this.pool.query<SubRow>(
      `SELECT * FROM billing.subscriptions
        WHERE customer_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [customerId],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }
}
