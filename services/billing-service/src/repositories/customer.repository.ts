import { Pool } from 'pg';
import { BillingCustomer, EntityType } from '../types';

/**
 * Data-access for billing.customers. Defined as an interface so services can be
 * unit-tested against an in-memory fake without a live Postgres.
 */
export interface CustomerRepository {
  findByEntity(entityType: EntityType, entityId: string): Promise<BillingCustomer | null>;
  findByStripeCustomerId(stripeCustomerId: string): Promise<BillingCustomer | null>;
  insert(row: {
    entityType: EntityType;
    entityId: string;
    stripeCustomerId: string;
  }): Promise<BillingCustomer>;
}

interface CustomerRow {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  stripe_customer_id: string;
}

function mapRow(r: CustomerRow): BillingCustomer {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    stripeCustomerId: r.stripe_customer_id,
  };
}

export class PgCustomerRepository implements CustomerRepository {
  constructor(private readonly pool: Pool) {}

  async findByEntity(
    entityType: EntityType,
    entityId: string,
  ): Promise<BillingCustomer | null> {
    const res = await this.pool.query<CustomerRow>(
      `SELECT id, entity_type, entity_id, stripe_customer_id
         FROM billing.customers
        WHERE entity_type = $1 AND entity_id = $2`,
      [entityType, entityId],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async findByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<BillingCustomer | null> {
    const res = await this.pool.query<CustomerRow>(
      `SELECT id, entity_type, entity_id, stripe_customer_id
         FROM billing.customers
        WHERE stripe_customer_id = $1`,
      [stripeCustomerId],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async insert(row: {
    entityType: EntityType;
    entityId: string;
    stripeCustomerId: string;
  }): Promise<BillingCustomer> {
    // ON CONFLICT guards a race where two requests create the same entity's
    // customer concurrently: the loser re-reads the winner's row.
    const res = await this.pool.query<CustomerRow>(
      `INSERT INTO billing.customers (entity_type, entity_id, stripe_customer_id)
            VALUES ($1, $2, $3)
       ON CONFLICT (entity_type, entity_id) DO UPDATE
            SET updated_at = now()
       RETURNING id, entity_type, entity_id, stripe_customer_id`,
      [row.entityType, row.entityId, row.stripeCustomerId],
    );
    return mapRow(res.rows[0]);
  }
}
