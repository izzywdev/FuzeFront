// Migration 6: seed provenance + per-list revision (docs/planning/selection-lists-events.md
// section 13, semantics in sections 5, 9 and 9.1).
//
// WHAT
//   selection_lists
//     revision            BIGINT NOT NULL DEFAULT 1   listRevision (section 5): monotonic per list.
//                                                     The WRITER bumps it (`revision = revision + 1`)
//                                                     in the same transaction as ANY change to the
//                                                     list or anything under it (items, translations).
//                                                     The DB enforces only the invariant: >= 1 and
//                                                     never decreasing (trigger below).
//     seed_source         TEXT        'platform' | app slug. NULL = user-authored row.
//     seed_key            TEXT        pack key.
//     seed_list_key       TEXT        the list key as seeded (survives user renames).
//     seed_version        INTEGER     pack version that last wrote the row.
//     seed_hash           TEXT        SHA-256 of exactly the content seeding wrote (section 9.1);
//                                     a mismatch with the recomputed current hash == user-modified.
//     seed_user_modified  BOOLEAN     persisted result of that comparison (cheap to emit in events).
//     is_seeded           BOOLEAN     GENERATED ALWAYS AS (seed_source IS NOT NULL) STORED.
//   selection_list_items: the same seed_* set minus revision / seed_list_key
//     (an item is identified by (list_id, code); its provenance parent is the list row).
//
// INVARIANTS (CHECK constraints; a seeded row is all-or-nothing)
//   ck_sl_seed_all_or_none / ck_sli_seed_all_or_none
//     seed_source, seed_key, seed_version, seed_hash (+ seed_list_key on lists) are either
//     ALL NULL (user-authored) or ALL NOT NULL (seeded).
//   ck_sl_seed_modified_needs_seed / ck_sli_...  seed_user_modified may only be true on a seeded row.
//   ck_sl_revision_positive                       revision >= 1.
//   ux_sl_seed_identity                           one list per (org, source, pack, seeded list key).
//
// created_by / granted_by / actor_id: already unconstrained TEXT (no CHECK, no FK, no
// usr_ regex at the DB level), so the 'system:selection-list-service' principal and the
// '[deleted-user]' sentinel (user-deleted.handler.ts) fit as-is; nothing is relaxed here.
// The usr_ pattern is an HTTP-contract concern (section 13.1), not a data-tier one.
//
// ROLE / GRANTS / RLS: tables are created and owned by the DB-owner role
// `selection_list_svc` (docs/runbooks/per-service-database-and-role.md), so no GRANT is
// needed; no other role has access. The service does not use row-level security (tenant
// isolation is application-enforced, and the database itself is per-service), so none is
// added here - adding RLS to only the new tables would be inconsistent.
//
// IDEMPOTENT: ADD COLUMN / CREATE INDEX use IF NOT EXISTS; constraints and the trigger are
// guarded. Existing rows are untouched: seed_* default NULL, revision backfills to 1.
// NOTE: ADD COLUMN ... GENERATED ... STORED rewrites the table once (small tables here).

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
      ADD COLUMN IF NOT EXISTS revision           BIGINT  NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS seed_source        TEXT,
      ADD COLUMN IF NOT EXISTS seed_key           TEXT,
      ADD COLUMN IF NOT EXISTS seed_list_key      TEXT,
      ADD COLUMN IF NOT EXISTS seed_version       INTEGER,
      ADD COLUMN IF NOT EXISTS seed_hash          TEXT,
      ADD COLUMN IF NOT EXISTS seed_user_modified BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_seeded          BOOLEAN GENERATED ALWAYS AS (seed_source IS NOT NULL) STORED
  `);

  await knex.raw(`
    ALTER TABLE selection_list_items
      ADD COLUMN IF NOT EXISTS seed_source        TEXT,
      ADD COLUMN IF NOT EXISTS seed_key           TEXT,
      ADD COLUMN IF NOT EXISTS seed_version       INTEGER,
      ADD COLUMN IF NOT EXISTS seed_hash          TEXT,
      ADD COLUMN IF NOT EXISTS seed_user_modified BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS is_seeded          BOOLEAN GENERATED ALWAYS AS (seed_source IS NOT NULL) STORED
  `);

  await knex.raw(addCheck('selection_lists', 'ck_sl_revision_positive', 'revision >= 1'));
  await knex.raw(
    addCheck(
      'selection_lists',
      'ck_sl_seed_all_or_none',
      `(seed_source IS NULL AND seed_key IS NULL AND seed_list_key IS NULL
         AND seed_version IS NULL AND seed_hash IS NULL)
       OR (seed_source IS NOT NULL AND seed_key IS NOT NULL AND seed_list_key IS NOT NULL
         AND seed_version IS NOT NULL AND seed_hash IS NOT NULL)`
    )
  );
  await knex.raw(
    addCheck('selection_lists', 'ck_sl_seed_modified_needs_seed', 'NOT seed_user_modified OR seed_source IS NOT NULL')
  );
  await knex.raw(
    addCheck(
      'selection_list_items',
      'ck_sli_seed_all_or_none',
      `(seed_source IS NULL AND seed_key IS NULL AND seed_version IS NULL AND seed_hash IS NULL)
       OR (seed_source IS NOT NULL AND seed_key IS NOT NULL AND seed_version IS NOT NULL
         AND seed_hash IS NOT NULL)`
    )
  );
  await knex.raw(
    addCheck(
      'selection_list_items',
      'ck_sli_seed_modified_needs_seed',
      'NOT seed_user_modified OR seed_source IS NOT NULL'
    )
  );

  // Seeding finds existing rows BY PROVENANCE, not by current key (users may rename).
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_sl_seed_identity
      ON selection_lists (organization_id, seed_source, seed_key, seed_list_key)
      WHERE seed_source IS NOT NULL
  `);

  // listRevision may only move forward. The writer owns the bump; this guards the invariant
  // so a buggy code path cannot publish a regressing revision (consumers gate on it).
  await knex.raw(`
    CREATE OR REPLACE FUNCTION selection_lists_revision_monotonic() RETURNS trigger AS $$
    BEGIN
      IF NEW.revision < OLD.revision THEN
        RAISE EXCEPTION 'selection_lists.revision must not decrease (id=%, % -> %)',
          OLD.id, OLD.revision, NEW.revision USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql
  `);
  await knex.raw('DROP TRIGGER IF EXISTS trg_selection_lists_revision_monotonic ON selection_lists');
  await knex.raw(`
    CREATE TRIGGER trg_selection_lists_revision_monotonic
      BEFORE UPDATE OF revision ON selection_lists
      FOR EACH ROW EXECUTE FUNCTION selection_lists_revision_monotonic()
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS trg_selection_lists_revision_monotonic ON selection_lists');
  await knex.raw('DROP FUNCTION IF EXISTS selection_lists_revision_monotonic()');
  await knex.raw('DROP INDEX IF EXISTS ux_sl_seed_identity');
  await knex.raw(`
    ALTER TABLE selection_list_items
      DROP CONSTRAINT IF EXISTS ck_sli_seed_modified_needs_seed,
      DROP CONSTRAINT IF EXISTS ck_sli_seed_all_or_none,
      DROP COLUMN IF EXISTS is_seeded,
      DROP COLUMN IF EXISTS seed_user_modified,
      DROP COLUMN IF EXISTS seed_hash,
      DROP COLUMN IF EXISTS seed_version,
      DROP COLUMN IF EXISTS seed_key,
      DROP COLUMN IF EXISTS seed_source
  `);
  await knex.raw(`
    ALTER TABLE selection_lists
      DROP CONSTRAINT IF EXISTS ck_sl_seed_modified_needs_seed,
      DROP CONSTRAINT IF EXISTS ck_sl_seed_all_or_none,
      DROP CONSTRAINT IF EXISTS ck_sl_revision_positive,
      DROP COLUMN IF EXISTS is_seeded,
      DROP COLUMN IF EXISTS seed_user_modified,
      DROP COLUMN IF EXISTS seed_hash,
      DROP COLUMN IF EXISTS seed_version,
      DROP COLUMN IF EXISTS seed_list_key,
      DROP COLUMN IF EXISTS seed_key,
      DROP COLUMN IF EXISTS seed_source,
      DROP COLUMN IF EXISTS revision
  `);
}
