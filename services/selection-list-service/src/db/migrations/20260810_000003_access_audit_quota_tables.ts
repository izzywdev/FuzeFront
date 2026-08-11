// Migration 3: access, audit, and quota tables.
//
// selection_list_access: ReBAC resource-instance role assignments. One row per
// (list, user); roles do not stack (PRIMARY KEY enforces one role per user per list).
//
// selection_list_audit: immutable append-only log. Both list_id and item_id are
// nullable — a list-level operation sets only list_id; an item-level operation
// sets both. `before`/`after` JSONB capture entity state around each change.
//
// selection_list_org_quota: per-org ceiling overrides. NULL means "use platform
// default". Full resolution (DB override -> platform config ceiling) is in S6.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS selection_list_access (
      list_id    TEXT NOT NULL REFERENCES selection_lists(id) ON DELETE RESTRICT,
      user_id    TEXT NOT NULL,
      role       TEXT NOT NULL CHECK (role IN ('list-owner','list-editor','list-contributor','list-translator','list-viewer')),
      granted_by TEXT NOT NULL,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (list_id, user_id)
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS selection_list_audit (
      id          TEXT PRIMARY KEY,
      list_id     TEXT REFERENCES selection_lists(id),
      item_id     TEXT REFERENCES selection_list_items(id),
      actor_id    TEXT NOT NULL,
      action      TEXT NOT NULL,
      before      JSONB,
      after       JSONB,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS selection_list_org_quota (
      organization_id     TEXT PRIMARY KEY,
      max_lists           INTEGER,
      max_lists_per_user  INTEGER,
      max_items_per_list  INTEGER,
      max_locales         INTEGER,
      updated_by          TEXT NOT NULL,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS selection_list_org_quota');
  await knex.raw('DROP TABLE IF EXISTS selection_list_audit');
  await knex.raw('DROP TABLE IF EXISTS selection_list_access');
}
