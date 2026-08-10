// Migration 5: add updated_at, revoked_at, org_id to selection_list_access.
//
// S7 (FFRNT-190) introduces soft-delete (revoked_at) so that the mirror table
// can track historical grants for audit purposes without losing rows on revoke.
// updated_at tracks the last mutation (grant or revoke).
// org_id is denormalised from the list row for query convenience.
//
// Back-fill: rows inserted by earlier migrations have no updated_at; we set it
// to granted_at so the column is NOT NULL from day one.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE selection_list_access
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS org_id     TEXT
  `);

  // Back-fill updated_at for pre-existing rows.
  await knex.raw(`
    UPDATE selection_list_access
    SET updated_at = granted_at
    WHERE updated_at IS NULL
  `);

  // Now enforce NOT NULL on updated_at.
  await knex.raw(`
    ALTER TABLE selection_list_access
      ALTER COLUMN updated_at SET NOT NULL,
      ALTER COLUMN updated_at SET DEFAULT now()
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE selection_list_access
      DROP COLUMN IF EXISTS org_id,
      DROP COLUMN IF EXISTS revoked_at,
      DROP COLUMN IF EXISTS updated_at
  `);
}
