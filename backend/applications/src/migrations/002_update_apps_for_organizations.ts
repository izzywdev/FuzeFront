import { Knex } from 'knex'

// applications-service migration 002 — adds org-related columns + visibility enum
// to `apps`. Rewritten to be IDEMPOTENT: the enum is created with a DO $$ ...
// EXCEPTION WHEN duplicate_object guard, and every column add is guarded by
// hasColumn, so on existing deployments (where the old monolith's migration 006
// already applied) this is a clean no-op instead of a "type/column already
// exists" crash. Runs under knex_migrations_apps, after the organizations table
// exists (applications-service waits for it before migrating).

async function addColumnIfMissing(
  knex: Knex,
  column: string,
  build: (table: Knex.AlterTableBuilder) => void
): Promise<void> {
  if (!(await knex.schema.hasColumn('apps', column))) {
    await knex.schema.alterTable('apps', table => build(table))
  }
}

export async function up(knex: Knex): Promise<void> {
  // Create the enum type only if it does not already exist.
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE app_visibility_enum AS ENUM ('private', 'organization', 'public', 'marketplace');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await addColumnIfMissing(knex, 'organization_id', table => {
    table
      .uuid('organization_id')
      .nullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE')
  })
  await addColumnIfMissing(knex, 'visibility', table => {
    table
      .enum('visibility', null as any, {
        useNative: true,
        existingType: true,
        enumName: 'app_visibility_enum',
      })
      .defaultTo('private')
  })
  await addColumnIfMissing(knex, 'marketplace_metadata', table => {
    table.jsonb('marketplace_metadata').defaultTo('{}')
  })
  await addColumnIfMissing(knex, 'is_marketplace_approved', table => {
    table.boolean('is_marketplace_approved').defaultTo(false)
  })
  await addColumnIfMissing(knex, 'marketplace_submitted_at', table => {
    table.timestamp('marketplace_submitted_at').nullable()
  })
  await addColumnIfMissing(knex, 'marketplace_approved_at', table => {
    table.timestamp('marketplace_approved_at').nullable()
  })
  await addColumnIfMissing(knex, 'approved_by', table => {
    table.uuid('approved_by').nullable().references('id').inTable('users')
  })
  await addColumnIfMissing(knex, 'install_permissions', table => {
    table.jsonb('install_permissions').defaultTo('{}')
  })
  await addColumnIfMissing(knex, 'install_count', table => {
    table.integer('install_count').defaultTo(0)
  })
  await addColumnIfMissing(knex, 'rating', table => {
    table.decimal('rating', 3, 2).nullable()
  })
  await addColumnIfMissing(knex, 'review_count', table => {
    table.integer('review_count').defaultTo(0)
  })

  // Indexes — CREATE INDEX IF NOT EXISTS keeps this idempotent too.
  await knex.raw('CREATE INDEX IF NOT EXISTS apps_organization_id_index ON apps (organization_id)')
  await knex.raw('CREATE INDEX IF NOT EXISTS apps_visibility_index ON apps (visibility)')
  await knex.raw('CREATE INDEX IF NOT EXISTS apps_is_marketplace_approved_index ON apps (is_marketplace_approved)')
  await knex.raw('CREATE INDEX IF NOT EXISTS apps_marketplace_submitted_at_index ON apps (marketplace_submitted_at)')
  await knex.raw('CREATE INDEX IF NOT EXISTS apps_install_count_index ON apps (install_count)')
  await knex.raw('CREATE INDEX IF NOT EXISTS apps_rating_index ON apps (rating)')
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
