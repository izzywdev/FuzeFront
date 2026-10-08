// Migration 7: seed ledger + seed-source allowlist (plan sections 8, 9, 13).
//
// selection_list_seed_ledger - the idempotency record for the seed algorithm.
//   PRIMARY KEY (organization_id, seed_source, seed_key, version) IS the ledger key (section 9):
//   a duplicate delivery / re-send of the same pack version cannot insert a second row, and
//   "highest applied version V_max for (org, source, pack)" is a prefix scan of this PK index.
//   content_hash   SHA-256 of the canonical JSON of `lists`; same version + different hash =>
//                  PACK_CONTENT_MISMATCH (a version's content is immutable).
//   manifest       { listKey: [itemCode, ...] } as applied (drives "removed from the pack" and
//                  "user purged it" detection on the next version).
//   result         the seed.completed `lists` array, re-emitted on `already-applied`.
//   request_id     NULL for platform seeds.  trigger: 'org-created' | 'backfill' | request trigger
//                  (open vocabulary on purpose - it is carried from the request, not a DB enum).
//   applied_by     'system:selection-list-service'.  attested_subject: introspected token subject,
//                  NULL for platform seeds.
//   No FKs: organization_id is a cross-service reference; the ledger deliberately outlives a
//   SOFT org delete (a restore must not re-seed) and is deleted by the HARD purge (application).
//
// selection_list_seed_sources - DB mirror of the reviewed seed-sources.json allowlist (synced
//   on startup; rows missing from the file are disabled, never deleted).
//
// Ownership/grants/RLS: see migration 6 header (owner role; no RLS in this service).
// IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS.

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS selection_list_seed_ledger (
      organization_id  TEXT        NOT NULL,
      seed_source      TEXT        NOT NULL,
      seed_key         TEXT        NOT NULL,
      version          INTEGER     NOT NULL CHECK (version >= 1),
      scope            TEXT        NOT NULL DEFAULT 'org' CHECK (scope IN ('org','user')),
      content_hash     TEXT        NOT NULL CHECK (content_hash <> ''),
      manifest         JSONB       NOT NULL,
      result           JSONB       NOT NULL,
      request_id       TEXT,
      trigger          TEXT        NOT NULL,
      applied_by       TEXT        NOT NULL,
      attested_subject TEXT,
      applied_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, seed_source, seed_key, version)
    )
  `);

  // Reconciler: "which orgs lack the current platform pack version" scans by (source, pack).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_sl_seed_ledger_source_key
      ON selection_list_seed_ledger (seed_source, seed_key, version)
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS selection_list_seed_sources (
      app                    TEXT        PRIMARY KEY CHECK (app <> 'platform' AND app <> ''),
      allowed_subjects       TEXT[]      NOT NULL,
      key_prefixes           TEXT[]      NOT NULL CHECK (cardinality(key_prefixes) >= 1),
      max_lists_per_request  INTEGER     NOT NULL CHECK (max_lists_per_request BETWEEN 1 AND 20),
      max_items_per_request  INTEGER     NOT NULL CHECK (max_items_per_request BETWEEN 1 AND 2000),
      enabled                BOOLEAN     NOT NULL DEFAULT true,
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS selection_list_seed_sources');
  await knex.raw('DROP INDEX IF EXISTS idx_sl_seed_ledger_source_key');
  await knex.raw('DROP TABLE IF EXISTS selection_list_seed_ledger');
}
