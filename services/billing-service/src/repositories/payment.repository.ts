import { Pool } from 'pg';
import { BillingPayment, EntityType, PaymentStatus } from '../types';

export interface PaymentUpsert {
  stripeSessionId: string;
  stripePaymentIntentId: string | null;
  productKey: string;
  externalOrderId: string;
  entityType: EntityType;
  entityId: string;
  amountTotalCents: number;
  currency: string;
  status: PaymentStatus;
}

/**
 * Data-access for billing.payments (the payment-mode Checkout mirror). Defined
 * as an interface so routes/handlers can be unit-tested against an in-memory
 * fake without a live Postgres.
 */
export interface PaymentRepository {
  upsert(row: PaymentUpsert): Promise<BillingPayment>;
  getBySessionId(stripeSessionId: string): Promise<BillingPayment | null>;
  /**
   * Latest mirror row for a consumer product's own order id. Used by the
   * payment_intent.payment_failed handler, whose event carries no session id —
   * only the {productKey, externalOrderId} metadata we stamped on the intent.
   */
  findByOrder(productKey: string, externalOrderId: string): Promise<BillingPayment | null>;
}

interface PaymentRow {
  id: string;
  stripe_session_id: string;
  stripe_payment_intent_id: string | null;
  product_key: string;
  external_order_id: string;
  entity_type: EntityType;
  entity_id: string;
  amount_total_cents: number;
  currency: string;
  status: PaymentStatus;
  created_at: Date;
  updated_at: Date;
}

function mapRow(r: PaymentRow): BillingPayment {
  return {
    id: r.id,
    stripeSessionId: r.stripe_session_id,
    stripePaymentIntentId: r.stripe_payment_intent_id,
    productKey: r.product_key,
    externalOrderId: r.external_order_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    amountTotalCents: r.amount_total_cents,
    currency: r.currency,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export class PgPaymentRepository implements PaymentRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(row: PaymentUpsert): Promise<BillingPayment> {
    // Status monotonicity on conflict:
    //  * 'paid' is terminal — never downgraded by a late/out-of-order webhook
    //    (a failed intent retried in the same session eventually pays; the
    //    stale payment_intent.payment_failed must not clobber the paid row).
    //  * 'pending' (the route's create-time mirror write, replayed on retry)
    //    never overwrites a status a webhook already advanced.
    // stripe_payment_intent_id is filled in as soon as ANY writer knows it and
    // never reset to NULL.
    const res = await this.pool.query<PaymentRow>(
      `INSERT INTO billing.payments
         (stripe_session_id, stripe_payment_intent_id, product_key,
          external_order_id, entity_type, entity_id, amount_total_cents,
          currency, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (stripe_session_id) DO UPDATE SET
          stripe_payment_intent_id = COALESCE(EXCLUDED.stripe_payment_intent_id,
                                              billing.payments.stripe_payment_intent_id),
          amount_total_cents       = EXCLUDED.amount_total_cents,
          currency                 = EXCLUDED.currency,
          status                   = CASE
                                       WHEN billing.payments.status = 'paid' THEN billing.payments.status
                                       WHEN EXCLUDED.status = 'pending' THEN billing.payments.status
                                       ELSE EXCLUDED.status
                                     END,
          updated_at               = now()
       RETURNING *`,
      [
        row.stripeSessionId,
        row.stripePaymentIntentId,
        row.productKey,
        row.externalOrderId,
        row.entityType,
        row.entityId,
        row.amountTotalCents,
        row.currency,
        row.status,
      ],
    );
    return mapRow(res.rows[0]);
  }

  async getBySessionId(stripeSessionId: string): Promise<BillingPayment | null> {
    const res = await this.pool.query<PaymentRow>(
      `SELECT * FROM billing.payments WHERE stripe_session_id = $1`,
      [stripeSessionId],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async findByOrder(
    productKey: string,
    externalOrderId: string,
  ): Promise<BillingPayment | null> {
    const res = await this.pool.query<PaymentRow>(
      `SELECT * FROM billing.payments
        WHERE product_key = $1 AND external_order_id = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [productKey, externalOrderId],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }
}
