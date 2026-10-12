import { Knex } from 'knex'

/**
 * Durable collaboration records created by the FuzePicker browser extension.
 *
 * The recipient is deliberately keyed by normalized email until they sign in:
 * this lets a mention be delivered before the recipient has a FuzeFront
 * account, while the API only exposes it after the authenticated account's
 * verified email matches that key.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('fuzepicker_mentions', table => {
    table.uuid('id').primary()
    table.uuid('sender_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.string('recipient_email', 320).notNullable()
    table.text('message').notNullable()
    table.text('page_url').notNullable()
    table.text('component_xpath').notNullable()
    table.string('status', 16).notNullable().defaultTo('unread')
    table.string('invite_token', 64).notNullable().unique()
    table.timestamp('invite_expires_at').notNullable()
    table.timestamps(true, true)

    table.index(['recipient_email', 'created_at'])
    table.index(['sender_id', 'created_at'])
  })

  await knex.schema.createTable('fuzepicker_mention_replies', table => {
    table.uuid('id').primary()
    table.uuid('mention_id').notNullable().references('id').inTable('fuzepicker_mentions').onDelete('CASCADE')
    table.uuid('author_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.text('message').notNullable()
    table.timestamps(true, true)

    table.index(['mention_id', 'created_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('fuzepicker_mention_replies')
  await knex.schema.dropTableIfExists('fuzepicker_mentions')
}
