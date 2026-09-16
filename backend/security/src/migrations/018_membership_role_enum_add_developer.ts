import { Knex } from 'knex'

// docs/planning/developers-portal.md §5.2 — root-org `developer` membership
// role, provisioned on first sign-in at developers.fuzefront.com
// (`ensureDeveloperMembership`). `ALTER TYPE ... ADD VALUE` cannot run inside
// a transaction block, and knex wraps migrations in a transaction by
// default, so this migration must not be wrapped in one (same discipline as
// 009_provisioning_backbone.ts's `organization_type_enum` extension). IF NOT
// EXISTS keeps it idempotent.
export const config = { transaction: false }

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TYPE membership_role_enum ADD VALUE IF NOT EXISTS 'developer'
  `)
}

export async function down(): Promise<void> {
  // Postgres has no ALTER TYPE ... DROP VALUE — removing an enum value
  // requires rebuilding the type, which would risk existing 'developer' rows.
  // No-op, matching this repo's convention for additive enum migrations
  // (see 009_provisioning_backbone.ts's down()).
}
