import { Knex } from 'knex'

/**
 * Migration 021 — recovery-code scheme version.
 *
 * Recovery codes issued before sign-in redemption existed were 5 random bytes
 * (40 bits) stored as an unsalted SHA-256: offline-crackable, which becomes an
 * MFA bypass the moment a code can be redeemed. New codes are >= 80 bits
 * (scheme 2). Existing rows are marked scheme 1 (the column default) and are
 * NEVER redeemable; users holding only scheme-1 codes see recoveryAvailable
 * false and are prompted to regenerate. Idempotent (hasColumn guard).
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('mfa_recovery_codes'))) return
  if (!(await knex.schema.hasColumn('mfa_recovery_codes', 'scheme_version'))) {
    await knex.schema.alterTable('mfa_recovery_codes', table => {
      // default 1 => every pre-existing row is legacy; new rows set 2 explicitly.
      table.integer('scheme_version').notNullable().defaultTo(1)
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('mfa_recovery_codes', 'scheme_version')) {
    await knex.schema.alterTable('mfa_recovery_codes', table => {
      table.dropColumn('scheme_version')
    })
  }
}
