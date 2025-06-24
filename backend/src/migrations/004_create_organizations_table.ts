import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // Create organization type enum
  await knex.raw(`
    CREATE TYPE organization_type_enum AS ENUM ('platform', 'organization');
  `)

  // Create organizations table
  return knex.schema.createTable('organizations', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.string('name', 255).notNullable()
    table.string('slug', 100).unique().notNullable()
    table
      .uuid('parent_id')
      .nullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE')
    table
      .uuid('owner_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE')
    table
      .enum('type', null, {
        useNative: true,
        enumName: 'organization_type_enum',
      })
      .notNullable()
    table.jsonb('settings').defaultTo('{}')
    table.jsonb('metadata').defaultTo('{}')
    table.boolean('is_active').defaultTo(true)
    table.timestamps(true, true)

    // Indexes for performance
    table.index(['slug'])
    table.index(['parent_id'])
    table.index(['owner_id'])
    table.index(['is_active'])
    table.index(['type'])
    table.index(['created_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('organizations')
  await knex.raw('DROP TYPE IF EXISTS organization_type_enum')
}
