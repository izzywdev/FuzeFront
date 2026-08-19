// Migration 2: translation tables.
//
// Translations are keyed by (entity_id, locale), never stored inline on the
// entity row, so locale fallback and machine-translation status are tracked
// independently per locale.
//
// ON DELETE RESTRICT: a list or item cannot be purged while translations exist.
// The application layer must purge translations first.
//
// source_hash: hash of the source-locale text the translation was produced from.
// When source text changes the hash no longer matches, marking the translation
// stale and eligible for autofill refresh.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS selection_list_translations (
      list_id     TEXT NOT NULL REFERENCES selection_lists(id) ON DELETE RESTRICT,
      locale      TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT,
      source_hash TEXT,
      is_machine  BOOLEAN NOT NULL DEFAULT false,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (list_id, locale)
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS selection_list_item_translations (
      item_id     TEXT NOT NULL REFERENCES selection_list_items(id) ON DELETE RESTRICT,
      locale      TEXT NOT NULL,
      label       TEXT NOT NULL,
      description TEXT,
      source_hash TEXT,
      is_machine  BOOLEAN NOT NULL DEFAULT false,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (item_id, locale)
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS selection_list_item_translations');
  await knex.raw('DROP TABLE IF EXISTS selection_list_translations');
}
