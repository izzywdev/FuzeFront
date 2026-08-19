import { Knex } from 'knex'

/**
 * Migration 013 — self-service password-reset tokens.
 *
 * Backs `POST /api/v1/security/session/password/reset-request` and
 * `/session/password/reset-confirm`. Provider-neutral: the row records only the
 * local user projection + the reset challenge; the credential itself lives in
 * the identity store, never here (no local password column, by design).
 *
 * Only the SHA-256 hex of the single-use token is stored — the raw token exists
 * solely in the dispatched message, so a DB read cannot reset an account.
 *
 * Idempotent (hasTable guard) so it runs alongside the existing 001-012 chain
 * against the shared knex_migrations table.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('password_resets'))) {
    await knex.schema.createTable('password_resets', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
      table
        .uuid('user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      // The address the reset was dispatched to (audit; may differ from a later
      // change of the user's primary email).
      table.string('email', 255).notNullable()
      // SHA-256 hex of the single-use reset token. Never the raw token.
      table.string('token_hash', 64).notNullable()
      table.timestamp('expires_at').notNullable()
      table.boolean('consumed').notNullable().defaultTo(false)
      table.timestamp('created_at').defaultTo(knex.fn.now())
      // Lookup is always by token_hash; unique so a hash collision/replay cannot
      // yield two live challenges.
      table.unique(['token_hash'])
      table.index(['user_id'])
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('password_resets')
}
