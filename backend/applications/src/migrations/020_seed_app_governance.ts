import type { Knex } from 'knex'
import { APP_GOVERNANCE, governanceColumns } from '../app-registry/app-governance'

/**
 * One-time seed of the operator-governed settings for the named products
 * (fuzedeploy, fuzecontact, fuzeagent, fuzequality, fuzesales, fuzeservice,
 * fuzex). Applies ONLY to rows that already exist at migration time — a product
 * that self-registers for the first time later is set via the admin UI (the DB
 * is the source of truth from here on). A fresh environment's built-in
 * (fuzeagent) is seeded instead by upsertBuiltin, which runs after migrations.
 *
 * This migration runs once and is not re-applied, so it never overrides a
 * subsequent operator edit. For org-scoped products it also aligns
 * visibility='organization'.
 */
export async function up(knex: Knex): Promise<void> {
  for (const [slug, gov] of Object.entries(APP_GOVERNANCE)) {
    const patch: Record<string, unknown> = {
      ...governanceColumns(gov),
      updated_at: new Date(),
    }
    if (gov.scopeLevel === 'organization') {
      patch.visibility = 'organization'
    }
    await knex('apps').where('slug', slug).update(patch)
  }
}

export async function down(): Promise<void> {
  // Data seed only — nothing to roll back (columns are dropped by 019.down).
}
