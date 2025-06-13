import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('apps', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.string('name').unique().notNullable()
    table.string('url').notNullable()
    table.string('icon_url').nullable()
    table.boolean('is_active').defaultTo(true)
    table
      .enum('integration_type', ['iframe', 'module_federation', 'spa'])
      .defaultTo('iframe')
    table.string('remote_url').nullable()
    table.string('scope').nullable()
    table.string('module').nullable()
    table.text('description').nullable()
    table.json('metadata').nullable()
    table.timestamps(true, true)

    // Indexes
    table.index(['name'])
    table.index(['is_active'])
    table.index(['integration_type'])
    table.index(['created_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTableIfExists('apps')
}
