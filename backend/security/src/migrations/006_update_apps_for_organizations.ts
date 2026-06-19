import { Knex } from 'knex'

// TOMBSTONE — do not delete this file and do not add SQL to it.
//
// In the 3-way split, applications-service is the SOLE owner of the `apps` table
// org-related columns + app_visibility_enum (its own idempotent migration under
// knex_migrations_apps). security-service keeps this file as an empty no-op so
// that knex's validateMigrationList does not throw "the following files are
// missing: 006_update_apps_for_organizations.js" on databases that already
// recorded migration 006. Removing it would crash already-migrated deployments.

export async function up(_knex: Knex): Promise<void> {
  // no-op: apps org columns owned by applications-service (see tombstone comment)
}

export async function down(_knex: Knex): Promise<void> {
  // no-op
}
