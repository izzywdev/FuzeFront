import { Knex } from 'knex';
/**
 * Migration 011 — billing columns on public-schema entities.
 *
 * Adds the four billing hot-path cache columns to both `users` and
 * `organizations`.  These are written back by the billing-service and read
 * by the backend for plan-gated UI hints.
 *
 * Columns:
 *   stripe_customer_id   TEXT, nullable
 *   billing_plan_tier    TEXT NOT NULL DEFAULT 'free'
 *   billing_plan_status  TEXT NOT NULL DEFAULT 'active'
 *   trial_ends_at        TIMESTAMPTZ, nullable
 *
 * All column additions are guarded with hasColumn so re-running is a no-op
 * (matches the idempotency approach used by migration 009).
 */
export declare function up(knex: Knex): Promise<void>;
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=011_add_billing_to_entities.d.ts.map