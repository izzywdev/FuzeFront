import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // Create app visibility enum
  await knex.raw(`
    CREATE TYPE app_visibility_enum AS ENUM ('private', 'organization', 'public', 'marketplace');
  `)

  // Add organization-related columns to apps table
  return knex.schema.alterTable('apps', table => {
    table
      .uuid('organization_id')
      .nullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE')
    table
      .enum('visibility', null, {
        useNative: true,
        enumName: 'app_visibility_enum',
      })
      .defaultTo('private')
    table.jsonb('marketplace_metadata').defaultTo('{}')
    table.boolean('is_marketplace_approved').defaultTo(false)
    table.timestamp('marketplace_submitted_at').nullable()
    table.timestamp('marketplace_approved_at').nullable()
    table.uuid('approved_by').nullable().references('id').inTable('users')
    table.jsonb('install_permissions').defaultTo('{}')
    table.integer('install_count').defaultTo(0)
    table.decimal('rating', 3, 2).nullable()
    table.integer('review_count').defaultTo(0)

    // Indexes for performance
    table.index(['organization_id'])
    table.index(['visibility'])
    table.index(['is_marketplace_approved'])
    table.index(['marketplace_submitted_at'])
    table.index(['install_count'])
    table.index(['rating'])
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema
    .alterTable('apps', table => {
      table.dropColumn('organization_id')
      table.dropColumn('visibility')
      table.dropColumn('marketplace_metadata')
      table.dropColumn('is_marketplace_approved')
      table.dropColumn('marketplace_submitted_at')
      table.dropColumn('marketplace_approved_at')
      table.dropColumn('approved_by')
      table.dropColumn('install_permissions')
      table.dropColumn('install_count')
      table.dropColumn('rating')
      table.dropColumn('review_count')
    })
    .then(() => {
      return knex.raw('DROP TYPE IF EXISTS app_visibility_enum')
    })
}
