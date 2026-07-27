import { Knex } from 'knex'

// applications-service migration 005 — adds the side-menu ordering columns that
// make `AppManifest.nav` sortable in SQL.
//
// WHY these are real columns and not just manifest JSON: the registry list is
// KEYSET-paginated, so its ORDER BY must be expressible as indexed columns. Before
// this migration the only ordering available was `created_at, slug` — i.e. the left
// menu was in REGISTRATION ORDER, and an app's lifecycle placement could not be
// expressed at all.
//
//   - nav_rank   int : 0-based render rank of `manifest.nav.section`, DERIVED from
//                      NAV_SECTIONS in app-registry/manifest.schema.ts. Stored as an
//                      integer because ordering by the section TEXT would sort
//                      alphabetically (build < executive < plan), which is wrong.
//   - nav_order  int : rank within the section, from `manifest.nav.order`.
//
// `manifest.nav` stays the SOURCE OF TRUTH; these columns are a derived projection
// recomputed on every register/update (see service.ts navColumns()). If NAV_SECTIONS
// is ever reordered, re-run the backfill below — the stored ranks would otherwise be
// stale relative to the new section order.
//
// Defaults match the contract's defaults (section `platform` = last rank, order 999)
// so every pre-existing row keeps a total, stable ordering and no row sorts randomly.
//
// Fully IDEMPOTENT: every column add is hasColumn-guarded and indexes use
// CREATE INDEX IF NOT EXISTS. Runs under knex_migrations_apps.

// Keep in lock-step with NAV_SECTIONS in app-registry/manifest.schema.ts.
const NAV_SECTIONS = [
  'executive',
  'plan',
  'build',
  'revenue',
  'customer',
  'insight',
  'platform',
]

const DEFAULT_NAV_RANK = NAV_SECTIONS.indexOf('platform')
const DEFAULT_NAV_ORDER = 999

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
  await addColumnIfMissing(knex, 'nav_rank', table => {
    table.integer('nav_rank').notNullable().defaultTo(DEFAULT_NAV_RANK)
  })
  await addColumnIfMissing(knex, 'nav_order', table => {
    table.integer('nav_order').notNullable().defaultTo(DEFAULT_NAV_ORDER)
  })

  // Backfill from the manifest for rows registered before this migration. Done as
  // one UPDATE per section (7 statements) rather than a JSON-path expression, so it
  // works identically on Postgres and the sqlite3 test database.
  for (let rank = 0; rank < NAV_SECTIONS.length; rank++) {
    await knex('apps')
      .whereNotNull('manifest')
      .whereRaw(
        // Substring match on the serialized manifest is deliberate: it avoids
        // per-dialect JSON operators (-> vs json_extract) for a one-time backfill.
        // A false positive only mis-ranks a legacy row, which the next write to
        // that app corrects.
        "CAST(manifest AS TEXT) LIKE ?",
        [`%"section":"${NAV_SECTIONS[rank]}"%`]
      )
      .update({ nav_rank: rank })
  }

  // The list query orders by (nav_rank, nav_order, created_at, slug) — index the
  // leading columns so keyset pagination stays a range scan rather than a sort.
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS apps_nav_order_index ON apps (nav_rank, nav_order)'
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS apps_nav_order_index')
  if (await knex.schema.hasColumn('apps', 'nav_rank')) {
    await knex.schema.alterTable('apps', table => table.dropColumn('nav_rank'))
  }
  if (await knex.schema.hasColumn('apps', 'nav_order')) {
    await knex.schema.alterTable('apps', table => table.dropColumn('nav_order'))
  }
}
