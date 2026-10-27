// Migration 11: shared / common lists and copy-on-write forks
// (docs/planning/selection-lists-shared-and-fork.md section 5; HTTP contract 4.1.0).
//
// WHAT
//   selection_lists
//     visibility            TEXT NOT NULL DEFAULT 'private'   'private' | 'org' | 'platform'. Who may READ the
//                                                              list without an instance grant. Never confers
//                                                              a mutation. Every list that exists before this
//                                                              migration is 'private' (the column default),
//                                                              so default behaviour is unchanged (R7).
//     forked_from_list_id   TEXT                               front_sl_... of the source of a fork. NOT a FK:
//                                                              the source lives in another tenant and may be
//                                                              purged later (provenance outlives it).
//     forked_from_org_id    TEXT                               org_... of the source's owner.
//     forked_from_revision  BIGINT                             the source's revision when copied.
//     forked_at             TIMESTAMPTZ                        when it was copied.
//   selection_list_items
//     origin_item_id        TEXT                               front_sli_... of the source item of a forked
//                                                              item. NOT a FK (same reasons).
//
// CONSTRAINTS / INDEXES
//   ck_sl_visibility          visibility IN ('private','org','platform').
//   ck_sl_fork_complete       the four forked_* columns are all NULL or all NOT NULL.
//   ck_sl_fork_not_platform   a fork is never a platform (common) list.
//   ux_sl_fork_per_org        ONE fork per (organization, source): the idempotency key of POST .../fork.
//   ix_sl_platform_key        key lookups of common lists (effective-list precedence, shadowing).
//   ix_sl_org_visible         shared-read listing of an organization's 'org' lists.
//   ux_sli_origin             an item of a fork has at most one origin item per list (and serves the resolve
//                             redirect join on (list_id, origin_item_id)).
//
// "A platform list is owned by the platform organization" is NOT a schema rule: the platform org id is
// configuration (SELECTION_LIST_PLATFORM_ORG_ID), enforced by the service (routes/lists.ts, seed/apply.ts).
//
// ADDITIVE and backward compatible: every new column is nullable or defaulted, existing rows keep their
// meaning, nothing is rewritten. data-contract.json declares forked_from_list_id / forked_from_org_id /
// origin_item_id as references (on-delete: retain).
//
// ROLE / GRANTS / RLS: see migration 6 header (nothing to add).
//
// IDEMPOTENT: ADD COLUMN / CREATE INDEX use IF NOT EXISTS; constraints are guarded on pg_constraint.

import type { Knex } from 'knex';

/** ADD CONSTRAINT has no IF NOT EXISTS in Postgres; guard on pg_constraint instead. */
const addCheck = (table: string, name: string, expr: string): string => `
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = '${name}' AND conrelid = '${table}'::regclass
    ) THEN
      ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expr});
    END IF;
  END $$
`;

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE selection_lists
      ADD COLUMN IF NOT EXISTS visibility           TEXT        NOT NULL DEFAULT 'private',
      ADD COLUMN IF NOT EXISTS forked_from_list_id  TEXT,
      ADD COLUMN IF NOT EXISTS forked_from_org_id   TEXT,
      ADD COLUMN IF NOT EXISTS forked_from_revision BIGINT,
      ADD COLUMN IF NOT EXISTS forked_at            TIMESTAMPTZ
  `);

  await knex.raw(`
    ALTER TABLE selection_list_items
      ADD COLUMN IF NOT EXISTS origin_item_id TEXT
  `);

  await knex.raw(addCheck('selection_lists', 'ck_sl_visibility', `visibility IN ('private','org','platform')`));
  await knex.raw(
    addCheck(
      'selection_lists',
      'ck_sl_fork_complete',
      `(forked_from_list_id IS NULL) = (forked_from_org_id IS NULL)
       AND (forked_from_list_id IS NULL) = (forked_from_revision IS NULL)
       AND (forked_from_list_id IS NULL) = (forked_at IS NULL)`,
    ),
  );
  await knex.raw(
    addCheck('selection_lists', 'ck_sl_fork_not_platform', `forked_from_list_id IS NULL OR visibility <> 'platform'`),
  );

  // One fork per (organization, source): the idempotency key of POST /v1/selection-lists/{listId}/fork.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_sl_fork_per_org
      ON selection_lists (organization_id, forked_from_list_id)
      WHERE forked_from_list_id IS NOT NULL
  `);
  // Shared-read and key-precedence lookups.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ix_sl_platform_key
      ON selection_lists (key) WHERE visibility = 'platform'
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ix_sl_org_visible
      ON selection_lists (organization_id, status) WHERE visibility = 'org'
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_sli_origin
      ON selection_list_items (list_id, origin_item_id)
      WHERE origin_item_id IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS ux_sli_origin');
  await knex.raw('DROP INDEX IF EXISTS ix_sl_org_visible');
  await knex.raw('DROP INDEX IF EXISTS ix_sl_platform_key');
  await knex.raw('DROP INDEX IF EXISTS ux_sl_fork_per_org');
  await knex.raw('ALTER TABLE selection_lists DROP CONSTRAINT IF EXISTS ck_sl_fork_not_platform');
  await knex.raw('ALTER TABLE selection_lists DROP CONSTRAINT IF EXISTS ck_sl_fork_complete');
  await knex.raw('ALTER TABLE selection_lists DROP CONSTRAINT IF EXISTS ck_sl_visibility');
  await knex.raw('ALTER TABLE selection_list_items DROP COLUMN IF EXISTS origin_item_id');
  await knex.raw(`
    ALTER TABLE selection_lists
      DROP COLUMN IF EXISTS forked_at,
      DROP COLUMN IF EXISTS forked_from_revision,
      DROP COLUMN IF EXISTS forked_from_org_id,
      DROP COLUMN IF EXISTS forked_from_list_id,
      DROP COLUMN IF EXISTS visibility
  `);
}
