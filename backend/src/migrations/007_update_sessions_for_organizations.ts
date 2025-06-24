import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('sessions', table => {
    table
      .uuid('active_organization_id')
      .nullable()
      .references('id')
      .inTable('organizations')
      .onDelete('SET NULL')
    table.jsonb('organization_context').defaultTo('{}')
    table.string('tenant_id', 255).nullable().alter() // Make consistent with apps table

    // Indexes for performance
    table.index(['active_organization_id'])
    table.index(['tenant_id'])
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('sessions', table => {
    table.dropColumn('active_organization_id')
    table.dropColumn('organization_context')
    // Note: We don't alter tenant_id back as it might contain data
  })
}
