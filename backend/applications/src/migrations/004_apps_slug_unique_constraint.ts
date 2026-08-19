import { Knex } from 'knex'

// applications-service migration 004 — make `apps.slug` a NON-PARTIAL unique
// index so it can serve as the arbiter for `INSERT … ON CONFLICT (slug)`.
//
// Migration 003 created a PARTIAL unique index (`apps_slug_unique`,
// `WHERE slug IS NOT NULL`). Postgres CANNOT use a partial index for ON CONFLICT
// arbiter inference, so `ensureBuiltins()` → `upsertBuiltin()` (which does
// `.onConflict('slug').ignore()`) raised
//   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
// on a fresh DB — the built-in Clock never got provisioned until a non-partial
// `apps_slug_key` was added by hand in prod. This migration adds that index
// durably so fresh databases and future deploys provision built-ins correctly.
//
// NULL slugs remain allowed: in a Postgres unique index NULLs are distinct, so
// legacy slug-less rows (created by migrations 001/002 before `slug` existed) do
// not collide. Non-NULL slugs were already unique via the partial index, so
// building the full unique index cannot fail on existing data.
//
// Fully IDEMPOTENT: CREATE UNIQUE INDEX IF NOT EXISTS with the SAME name a hand
// -applied prod fix used (`apps_slug_key`), so it is a no-op where the index
// already exists. The now-redundant partial index is dropped.

export async function up(knex: Knex): Promise<void> {
  // Non-partial unique index on slug — usable as the ON CONFLICT (slug) arbiter.
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS apps_slug_key ON apps (slug)')
  // The partial index from migration 003 is now redundant (the full unique index
  // also enforces non-null uniqueness) and cannot serve ON CONFLICT — drop it.
  await knex.raw('DROP INDEX IF EXISTS apps_slug_unique')
}

export async function down(knex: Knex): Promise<void> {
  // Restore the partial unique index, then drop the non-partial one.
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS apps_slug_unique ON apps (slug) WHERE slug IS NOT NULL'
  )
  await knex.raw('DROP INDEX IF EXISTS apps_slug_key')
}
