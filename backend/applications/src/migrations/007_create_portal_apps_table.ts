import { Knex } from 'knex'

// applications-service migration 005 — FF-EPIC-12-S1: `portal_apps`, the
// per-portal app-catalog entitlement table. Backs the catalog service
// (`app-registry/catalog.ts`) that S2's `list()` portal filter and S3's admin
// API both build on.
//
// WHY THIS TABLE LIVES HERE (applications-service, not the host backend):
// `apps.id` (the FK target for `app_id`) is owned by THIS service's `apps`
// table (migration 001). `portals.id` (the FK target for `portal_id`) is owned
// by the host backend (`backend/src/migrations/012_create_portals_table.ts`)
// but resolves against the SAME physical Postgres database — every FuzeFront
// backend service shares one `fuzefront_platform` database, split only by
// migration-table namespace (`knex_migrations_apps` here vs `knex_migrations`
// on the host backend), exactly like migration 002's existing FK from `apps`
// to `organizations` (a host-backend-owned table). A table needing FKs into
// BOTH `apps` and `portals` can only be created in one place; the applications
// -service already owns the "FK into another service's core tables" pattern,
// so this migration follows it rather than inventing a second one on the host
// backend.
//
// CROSS-SERVICE ORDERING: `portals` must exist before this migration runs, the
// same requirement migration 002 has on `organizations`. `src/index.ts` now
// calls `waitForTable('portals', ...)` (mirroring the existing
// `waitForTable('organizations', ...)` call) before `runMigrations()`.
//
// IDEMPOTENT: hasTable-guarded, so a re-run against a DB that already has
// `portal_apps` is a clean no-op.
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('portal_apps')) {
    return
  }

  await knex.schema.createTable('portal_apps', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    // portals.id is a server-issued prefixed string id (`prt_...`, varchar(44))
    // — NOT a uuid. Must match the column type declared in
    // backend/src/migrations/012_create_portals_table.ts exactly, or the FK
    // fails to resolve.
    table
      .string('portal_id', 44)
      .notNullable()
      .references('id')
      .inTable('portals')
      .onDelete('CASCADE')
    table
      .uuid('app_id')
      .notNullable()
      .references('id')
      .inTable('apps')
      .onDelete('CASCADE')
    table.boolean('enabled').notNullable().defaultTo(true)
    // Stable tiebreaker for ordering is `app_id` (see catalog.ts's cursor),
    // per the epic's own risk note: "mitigate with a stable tiebreaker...
    // rather than allowing nondeterministic ordering."
    table.integer('pinned_order').notNullable().defaultTo(0)
    table.jsonb('config').notNullable().defaultTo('{}')
    table.timestamps(true, true)

    // AC1 — unique constraint on (portal_id, app_id): a portal can only have
    // one entitlement row per app. This is also the upsert arbiter the catalog
    // service's enable() path relies on for idempotency.
    table.unique(['portal_id', 'app_id'])
    table.index(['portal_id'])
    table.index(['portal_id', 'enabled'])
    table.index(['app_id'])
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTableIfExists('portal_apps')
}
