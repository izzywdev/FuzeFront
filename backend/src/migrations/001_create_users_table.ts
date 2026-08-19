import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('users', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.string('email').unique().notNullable()
    table.string('password_hash').nullable()
    table.string('first_name').nullable()
    table.string('last_name').nullable()
    table.uuid('default_app_id').nullable()
    table.json('roles').defaultTo('["user"]')
    table.timestamps(true, true)

    // Indexes
    table.index(['email'])
    table.index(['created_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTableIfExists('users')
}
