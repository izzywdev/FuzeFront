import { Knex } from 'knex'

/**
 * Adds soft-deactivation columns to `users`.
 *
 * Until now the users table was hard-delete-only (no runtime delete path at
 * all). FFRNT-172 introduces self-service account deactivation (DELETE /api/me)
 * which flips `is_active` to false and stamps `deactivated_at`, then emits
 * `identity.user.deleted` (cascade:'soft') so downstream services tear down the
 * user's external state (Permit principal, sessions) — mirroring the
 * organization soft-delete pattern.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', table => {
    table.boolean('is_active').notNullable().defaultTo(true)
    table.timestamp('deactivated_at').nullable()
    table.index(['is_active'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', table => {
    table.dropIndex(['is_active'])
    table.dropColumn('deactivated_at')
    table.dropColumn('is_active')
  })
}
