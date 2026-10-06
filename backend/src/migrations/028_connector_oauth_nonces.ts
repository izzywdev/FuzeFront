import { Knex } from 'knex'

/** One-time OAuth callback state across all FuzeFront backend replicas. */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('connector_oauth_nonces')) return
  await knex.schema.createTable('connector_oauth_nonces', table => {
    table.string('nonce_hash', 64).primary()
    table.timestamp('expires_at', { useTz: true }).notNullable().index()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('connector_oauth_nonces')
}
