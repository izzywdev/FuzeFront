import { Knex } from 'knex'

// ⚠️ MIGRATION NUMBER COLLISION (must resolve before merging both tracks):
// The identity track (feature/api-tokens) also adds a `010_*` migration
// (`010_api_tokens`). Knex applies migrations by filename order, so two `010_*`
// files in the same dir will collide / double-apply ordering. Final integration
// MUST renumber ONE of the two `010` migrations (this one or `010_api_tokens`)
// to a unique sequence number. Tracked in PR #66.

/**
 * Migration 010 — billing columns on public-schema entities.
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

export async function up(knex: Knex): Promise<void> {
  // --- users ---
  const usersStripeId = await knex.schema.hasColumn('users', 'stripe_customer_id')
  if (!usersStripeId) {
    await knex.schema.alterTable('users', table => {
      table.text('stripe_customer_id').nullable()
    })
  }

  const usersTier = await knex.schema.hasColumn('users', 'billing_plan_tier')
  if (!usersTier) {
    await knex.schema.alterTable('users', table => {
      table.text('billing_plan_tier').notNullable().defaultTo('free')
    })
  }

  const usersStatus = await knex.schema.hasColumn('users', 'billing_plan_status')
  if (!usersStatus) {
    await knex.schema.alterTable('users', table => {
      table.text('billing_plan_status').notNullable().defaultTo('active')
    })
  }

  const usersTrialEnds = await knex.schema.hasColumn('users', 'trial_ends_at')
  if (!usersTrialEnds) {
    await knex.schema.alterTable('users', table => {
      table.timestamp('trial_ends_at', { useTz: true }).nullable()
    })
  }

  // --- organizations ---
  const orgsStripeId = await knex.schema.hasColumn('organizations', 'stripe_customer_id')
  if (!orgsStripeId) {
    await knex.schema.alterTable('organizations', table => {
      table.text('stripe_customer_id').nullable()
    })
  }

  const orgsTier = await knex.schema.hasColumn('organizations', 'billing_plan_tier')
  if (!orgsTier) {
    await knex.schema.alterTable('organizations', table => {
      table.text('billing_plan_tier').notNullable().defaultTo('free')
    })
  }

  const orgsStatus = await knex.schema.hasColumn('organizations', 'billing_plan_status')
  if (!orgsStatus) {
    await knex.schema.alterTable('organizations', table => {
      table.text('billing_plan_status').notNullable().defaultTo('active')
    })
  }

  const orgsTrialEnds = await knex.schema.hasColumn('organizations', 'trial_ends_at')
  if (!orgsTrialEnds) {
    await knex.schema.alterTable('organizations', table => {
      table.timestamp('trial_ends_at', { useTz: true }).nullable()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  // --- users ---
  const usersTrialEnds = await knex.schema.hasColumn('users', 'trial_ends_at')
  if (usersTrialEnds) {
    await knex.schema.alterTable('users', table => {
      table.dropColumn('trial_ends_at')
    })
  }

  const usersStatus = await knex.schema.hasColumn('users', 'billing_plan_status')
  if (usersStatus) {
    await knex.schema.alterTable('users', table => {
      table.dropColumn('billing_plan_status')
    })
  }

  const usersTier = await knex.schema.hasColumn('users', 'billing_plan_tier')
  if (usersTier) {
    await knex.schema.alterTable('users', table => {
      table.dropColumn('billing_plan_tier')
    })
  }

  const usersStripeId = await knex.schema.hasColumn('users', 'stripe_customer_id')
  if (usersStripeId) {
    await knex.schema.alterTable('users', table => {
      table.dropColumn('stripe_customer_id')
    })
  }

  // --- organizations ---
  const orgsTrialEnds = await knex.schema.hasColumn('organizations', 'trial_ends_at')
  if (orgsTrialEnds) {
    await knex.schema.alterTable('organizations', table => {
      table.dropColumn('trial_ends_at')
    })
  }

  const orgsStatus = await knex.schema.hasColumn('organizations', 'billing_plan_status')
  if (orgsStatus) {
    await knex.schema.alterTable('organizations', table => {
      table.dropColumn('billing_plan_status')
    })
  }

  const orgsTier = await knex.schema.hasColumn('organizations', 'billing_plan_tier')
  if (orgsTier) {
    await knex.schema.alterTable('organizations', table => {
      table.dropColumn('billing_plan_tier')
    })
  }

  const orgsStripeId = await knex.schema.hasColumn('organizations', 'stripe_customer_id')
  if (orgsStripeId) {
    await knex.schema.alterTable('organizations', table => {
      table.dropColumn('stripe_customer_id')
    })
  }
}
