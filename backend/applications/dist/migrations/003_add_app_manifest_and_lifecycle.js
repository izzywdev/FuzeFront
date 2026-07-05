"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
// applications-service migration 003 — adds the app-registry contract columns to
// `apps` so a full App Manifest + an explicit lifecycle can be persisted (the
// `/api/v1/app-registry` surface frozen in services/app-registry-service/openapi.yaml).
//
// Net-new columns over the legacy schema (001 + 002):
//   - manifest      jsonb   : the full declarative AppManifest, served back on read
//   - slug          varchar : url-safe immutable unique id (the contract's primary key)
//   - status        enum    : registered | activated | suspended (lifecycle)
//   - mode          enum    : portal | standalone
//   - builtin       boolean : shipped with the platform; suspend-only, never deletable
//   - last_seen_at  tstz    : latest heartbeat timestamp
//   - is_healthy    boolean : latest heartbeat-derived health (null = unknown)
//   - heartbeat_token varchar: per-app token authenticating the heartbeat endpoint
//
// Legacy columns (name/url/is_active/integration_type/…) are KEPT untouched for
// back-compat with the `/api/apps` routes. Fully IDEMPOTENT: enum types are
// created with a duplicate_object guard, every column add is hasColumn-guarded,
// and indexes use CREATE INDEX IF NOT EXISTS. Runs under knex_migrations_apps.
async function addColumnIfMissing(knex, column, build) {
    if (!(await knex.schema.hasColumn('apps', column))) {
        await knex.schema.alterTable('apps', table => build(table));
    }
}
async function up(knex) {
    // Lifecycle status enum (registered → activated → suspended).
    await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE app_status_enum AS ENUM ('registered', 'activated', 'suspended');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
    // App mode enum (portal | standalone).
    await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE app_mode_enum AS ENUM ('portal', 'standalone');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
    await addColumnIfMissing(knex, 'slug', table => {
        table.string('slug').nullable();
    });
    await addColumnIfMissing(knex, 'manifest', table => {
        table.jsonb('manifest').nullable();
    });
    await addColumnIfMissing(knex, 'status', table => {
        table
            .enum('status', null, {
            useNative: true,
            existingType: true,
            enumName: 'app_status_enum',
        })
            .notNullable()
            .defaultTo('registered');
    });
    await addColumnIfMissing(knex, 'mode', table => {
        table
            .enum('mode', null, {
            useNative: true,
            existingType: true,
            enumName: 'app_mode_enum',
        })
            .notNullable()
            .defaultTo('portal');
    });
    await addColumnIfMissing(knex, 'builtin', table => {
        table.boolean('builtin').notNullable().defaultTo(false);
    });
    await addColumnIfMissing(knex, 'last_seen_at', table => {
        table.timestamp('last_seen_at').nullable();
    });
    await addColumnIfMissing(knex, 'is_healthy', table => {
        table.boolean('is_healthy').nullable();
    });
    await addColumnIfMissing(knex, 'heartbeat_token', table => {
        table.string('heartbeat_token').nullable();
    });
    // slug is the contract's immutable primary identifier — UNIQUE. Partial unique
    // index (WHERE slug IS NOT NULL) so legacy rows without a slug don't collide.
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS apps_slug_unique ON apps (slug) WHERE slug IS NOT NULL');
    await knex.raw('CREATE INDEX IF NOT EXISTS apps_status_index ON apps (status)');
    await knex.raw('CREATE INDEX IF NOT EXISTS apps_mode_index ON apps (mode)');
    await knex.raw('CREATE INDEX IF NOT EXISTS apps_builtin_index ON apps (builtin)');
    // organization_id index already created by migration 002; re-assert idempotently.
    await knex.raw('CREATE INDEX IF NOT EXISTS apps_organization_id_index ON apps (organization_id)');
}
async function down(knex) {
    await knex.raw('DROP INDEX IF EXISTS apps_slug_unique');
    await knex.raw('DROP INDEX IF EXISTS apps_status_index');
    await knex.raw('DROP INDEX IF EXISTS apps_mode_index');
    await knex.raw('DROP INDEX IF EXISTS apps_builtin_index');
    await knex.schema.alterTable('apps', table => {
        table.dropColumn('slug');
        table.dropColumn('manifest');
        table.dropColumn('status');
        table.dropColumn('mode');
        table.dropColumn('builtin');
        table.dropColumn('last_seen_at');
        table.dropColumn('is_healthy');
        table.dropColumn('heartbeat_token');
    });
    await knex.raw('DROP TYPE IF EXISTS app_status_enum');
    await knex.raw('DROP TYPE IF EXISTS app_mode_enum');
}
//# sourceMappingURL=003_add_app_manifest_and_lifecycle.js.map