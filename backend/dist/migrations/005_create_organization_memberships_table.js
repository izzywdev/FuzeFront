'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.up = up
exports.down = down
async function up(knex) {
  // Create membership role enum
  await knex.raw(`
    CREATE TYPE membership_role_enum AS ENUM ('owner', 'admin', 'member', 'viewer');
  `)
  // Create membership status enum
  await knex.raw(`
    CREATE TYPE membership_status_enum AS ENUM ('active', 'pending', 'suspended', 'revoked');
  `)
  // Create organization_memberships table
  return knex.schema.createTable('organization_memberships', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE')
    table
      .uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE')
    table
      .enum('role', null, { useNative: true, enumName: 'membership_role_enum' })
      .notNullable()
    table
      .enum('status', null, {
        useNative: true,
        enumName: 'membership_status_enum',
      })
      .defaultTo('active')
    table.uuid('invited_by').nullable().references('id').inTable('users')
    table.timestamp('invited_at').nullable()
    table.timestamp('joined_at').nullable()
    table.jsonb('permissions').defaultTo('{}')
    table.jsonb('metadata').defaultTo('{}')
    table.timestamps(true, true)
    // Unique constraint to prevent duplicate memberships
    table.unique(['user_id', 'organization_id'])
    // Indexes for performance
    table.index(['user_id'])
    table.index(['organization_id'])
    table.index(['role'])
    table.index(['status'])
    table.index(['invited_by'])
    table.index(['joined_at'])
    table.index(['created_at'])
  })
}
async function down(knex) {
  await knex.schema.dropTableIfExists('organization_memberships')
  await knex.raw('DROP TYPE IF EXISTS membership_role_enum')
  await knex.raw('DROP TYPE IF EXISTS membership_status_enum')
}
//# sourceMappingURL=005_create_organization_memberships_table.js.map
