"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
// TOMBSTONE — do not delete this file and do not add SQL to it.
//
// In the 3-way split, applications-service is the SOLE owner of the `apps` table
// DDL (its own migration chain under knex_migrations_apps). security-service
// keeps this file as an empty no-op so that knex's validateMigrationList does
// not throw "the following files are missing: 002_create_apps_table.js" on
// databases that already recorded migration 002 in their knex_migrations table.
// Removing it would crash every already-migrated deployment on next startup.
async function up(_knex) {
    // no-op: apps DDL is owned by applications-service (see tombstone comment)
}
async function down(_knex) {
    // no-op
}
//# sourceMappingURL=002_create_apps_table.js.map