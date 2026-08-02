import { Knex } from 'knex'

/**
 * Adds the two ReBAC provisioning steps to `provisioning_step_enum`.
 *
 * `organization_provisioning.step` is a native Postgres enum created by
 * migration 009 with exactly four members. Adding `permit_org_instance` and
 * `permit_org_parent` to PROVISIONING_STEPS in code without extending the enum
 * makes `ensureStepRows()` fail on every reconcile with:
 *
 *   invalid input value for enum provisioning_step_enum: "permit_org_instance"
 *
 * which aborts the whole insert — so NO step rows are created and organization
 * provisioning stops working entirely, not just for the new steps.
 */

// ALTER TYPE ... ADD VALUE cannot run inside a transaction block, and knex wraps
// migrations in a transaction by default — same reasoning as migration 009.
export const config = { transaction: false }

export async function up(knex: Knex): Promise<void> {
  // IF NOT EXISTS keeps this idempotent across re-runs and partially migrated DBs.
  await knex.raw(`
    ALTER TYPE provisioning_step_enum ADD VALUE IF NOT EXISTS 'permit_org_instance'
  `)
  await knex.raw(`
    ALTER TYPE provisioning_step_enum ADD VALUE IF NOT EXISTS 'permit_org_parent'
  `)
}

export async function down(_knex: Knex): Promise<void> {
  // Postgres has no ALTER TYPE ... DROP VALUE; the members are left in place,
  // exactly as migration 009 leaves 'personal' on organization_type_enum.
}
