// Migration 1: core tables — selection_lists and selection_list_items.
//
// IDENTITY MODEL: organization_id, created_by are TEXT opaque references to
// entities owned by other services. Cross-database FKs are impossible in Postgres;
// referential integrity to users/orgs is an application-layer concern.
// Intra-service FKs (items -> lists) are enforced with ON DELETE RESTRICT.
//
// IDs: TypeID strings, minted via mintId() from @izzywdev/fuzefront-identity.
//   selection list:      front_sl_  (registry key: selectionList)
//   selection list item: front_sli_ (registry key: selectionListItem)
//
// ON DELETE RESTRICT on items->list: a list cannot be purged while it has items.
// All CREATE TABLE statements use IF NOT EXISTS for idempotency.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS selection_lists (
      id              TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      key             TEXT NOT NULL,
      source_locale   TEXT NOT NULL DEFAULT 'en',
      status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      created_by      TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (organization_id, key)
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS selection_list_items (
      id          TEXT PRIMARY KEY,
      list_id     TEXT NOT NULL REFERENCES selection_lists(id) ON DELETE RESTRICT,
      code        TEXT NOT NULL,
      sort_order  INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      created_by  TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (list_id, code)
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS selection_list_items');
  await knex.raw('DROP TABLE IF EXISTS selection_lists');
}
