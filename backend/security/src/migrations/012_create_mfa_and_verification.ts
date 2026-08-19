import { Knex } from 'knex'

/**
 * Migration 012 — MFA factors, recovery codes, login step-up challenges, and
 * contact-ownership verification state.
 *
 * Backs the provider-agnostic AuthN surface (`/api/v1/security/mfa/*` and
 * `/api/v1/security/verify/*`). Provider-neutral: the `type` column carries the
 * neutral factor kind (`totp`/`sms`/`email`), never a vendor name. Secrets and
 * recovery codes are stored hashed / to-be-shown-once semantics enforced in the
 * application layer.
 *
 * Idempotent (hasTable guards) so it can run alongside the existing 001-011
 * chain against the shared knex_migrations table.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('mfa_factors'))) {
    await knex.schema.createTable('mfa_factors', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('type', 16).notNullable() // totp | sms | email
      table.string('status', 16).notNullable().defaultTo('pending') // pending | active
      // TOTP shared secret (base32). Null for sms/email factors.
      table.string('secret', 128).nullable()
      // Neutral display hint (masked phone/email). Never a provider name.
      table.string('label', 255).nullable()
      // Delivery target for sms/email OTP factors.
      table.string('target', 255).nullable()
      table.timestamps(true, true)
      table.index(['user_id'])
    })
  }

  if (!(await knex.schema.hasTable('mfa_recovery_codes'))) {
    await knex.schema.createTable('mfa_recovery_codes', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      // SHA-256 hex of the single-use code.
      table.string('code_hash', 64).notNullable()
      table.boolean('used').notNullable().defaultTo(false)
      table.timestamp('created_at').defaultTo(knex.fn.now())
      table.index(['user_id'])
    })
  }

  // Contact-ownership verification state, attached to the user.
  if (!(await knex.schema.hasColumn('users', 'email_verified'))) {
    await knex.schema.alterTable('users', table => {
      table.boolean('email_verified').notNullable().defaultTo(false)
      table.boolean('phone_verified').notNullable().defaultTo(false)
      table.string('phone', 32).nullable()
    })
  }

  // Email-verification tokens (link) / codes (OTP). Phone OTP is delegated to
  // the family SMS Verify service, so no local phone-code store is needed.
  if (!(await knex.schema.hasTable('email_verifications'))) {
    await knex.schema.createTable('email_verifications', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
      table.uuid('user_id').nullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('email', 255).notNullable()
      table.string('token_hash', 64).notNullable() // SHA-256 of the link token
      table.string('code_hash', 64).notNullable() // SHA-256 of the OTP code
      table.timestamp('expires_at').notNullable()
      table.boolean('consumed').notNullable().defaultTo(false)
      table.timestamp('created_at').defaultTo(knex.fn.now())
      table.index(['email'])
      table.index(['token_hash'])
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('email_verifications')
  await knex.schema.dropTableIfExists('mfa_recovery_codes')
  await knex.schema.dropTableIfExists('mfa_factors')
  if (await knex.schema.hasColumn('users', 'email_verified')) {
    await knex.schema.alterTable('users', table => {
      table.dropColumn('email_verified')
      table.dropColumn('phone_verified')
      table.dropColumn('phone')
    })
  }
}
