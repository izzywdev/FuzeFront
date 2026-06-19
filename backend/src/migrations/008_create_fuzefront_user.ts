import { Knex } from 'knex'

// TOMBSTONE — do not delete this file and do not add SQL to it.
//
// The original migration 008 provisioned a least-privilege `fuzefront` Postgres
// role and database.  That work has moved to the Helm pre-install bootstrap Job
// (charts/fuzefront/templates/db-bootstrap-job.yaml) and the companion script
// src/scripts/db-bootstrap.ts, which run with elevated credentials at deploy
// time before the application container ever starts.
//
// This file is retained as a no-op tombstone so that knex's validateMigrationList
// does not throw "The migration directory is corrupt, the following files are
// missing: 008_create_fuzefront_user.js" on databases that already recorded
// this migration number in their knex_migrations table.  Removing it would
// crash every already-migrated deployment on the next startup.

export async function up(_knex: Knex): Promise<void> {
  // no-op: see tombstone comment above
}

export async function down(_knex: Knex): Promise<void> {
  // no-op: see tombstone comment above
}
