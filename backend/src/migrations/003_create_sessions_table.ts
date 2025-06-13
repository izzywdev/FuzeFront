import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('sessions', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.uuid('user_id').notNullable()
    table.string('tenant_id').nullable()
    table.timestamp('expires_at').notNullable()
    table.timestamps(true, true)

    // Foreign key constraints
    table
      .foreign('user_id')
      .references('id')
      .inTable('users')
      .onDelete('CASCADE')

    // Indexes
    table.index(['user_id'])
    table.index(['expires_at'])
    table.index(['tenant_id'])
    table.index(['created_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTableIfExists('sessions')
}
