import { Knex } from 'knex'

// applications-service migration 006 — stores an app's self-declared authorization
// policy and billing profile on the app row.
//
// WHY: before this, onboarding a product required TWO hand edits inside the platform
// repo that the product team could not make and would not see:
//   - its Permit resources/roles hand-written into backend/src/permit/products/*.policy.ts
//     AND added to a hardcoded list in sync-permit-schema.ts (a policy missing from
//     that list silently never reached the policy provider), and
//   - its billing productKey appended to the BILLING_PRODUCT_KEYS env allowlist in
//     the platform's Helm values, coupling product onboarding to a platform redeploy.
//
// Both are now submitted by the product itself at registration
// (PUT /apps/{slug}/policy, PUT /apps/{slug}/billing-profile) and stored here.
// The permit-schema sync job reads policies from this column instead of a literal
// list, so adding a product no longer edits platform source.
//
// 1:1 with the app, so columns on `apps` rather than side tables — an app has exactly
// one policy and one billing profile, and both are replaced wholesale, never merged.
//
// Fully IDEMPOTENT: hasColumn-guarded. Runs under knex_migrations_apps.

async function addColumnIfMissing(
  knex: Knex,
  column: string,
  build: (table: Knex.AlterTableBuilder) => void
): Promise<void> {
  if (!(await knex.schema.hasColumn('apps', column))) {
    await knex.schema.alterTable('apps', table => build(table))
  }
}

export async function up(knex: Knex): Promise<void> {
  // The product's ProductPolicy as SUBMITTED — bare, un-namespaced keys. Namespacing
  // and merging into the base schema happens at sync time, so what is stored stays
  // exactly what the product declared and can be re-synced after a merge-logic change.
  await addColumnIfMissing(knex, 'policy', table => {
    table.jsonb('policy').nullable()
  })
  await addColumnIfMissing(knex, 'billing_profile', table => {
    table.jsonb('billing_profile').nullable()
  })

  // The permit sync job and the billing config both scan for rows that HAVE one of
  // these; index so those scans stay cheap as the registry grows.
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS apps_has_policy_index ON apps (slug) WHERE policy IS NOT NULL'
  )
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS apps_has_billing_index ON apps (slug) WHERE billing_profile IS NOT NULL'
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS apps_has_policy_index')
  await knex.raw('DROP INDEX IF EXISTS apps_has_billing_index')
  if (await knex.schema.hasColumn('apps', 'policy')) {
    await knex.schema.alterTable('apps', table => table.dropColumn('policy'))
  }
  if (await knex.schema.hasColumn('apps', 'billing_profile')) {
    await knex.schema.alterTable('apps', table => table.dropColumn('billing_profile'))
  }
}
