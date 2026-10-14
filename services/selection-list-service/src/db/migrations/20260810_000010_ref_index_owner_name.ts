// Migration 10: org projection learns who owns the org, what it is called, and how fresh the snapshot is
// (docs/planning/selection-lists-events.md section 13.0.5).
//
//   owner_id     the org owner's WIRE id (`usr_...` TypeID, rendered from the bare UUID that
//                `identity.org.created.ownerId` carries). NULL = unknown / the root org has no owner.
//                Used to grant `list-owner` on the platform-seeded lists of the org (decision Q3).
//   org_name     the org's display name, refreshed by `identity.org.created` / `identity.org.updated`.
//   snapshot_at  the envelope `occurredAt` of the newest org snapshot applied. A snapshot older than
//                this is ignored, so a late `org.created` cannot overwrite what `org.updated` already
//                taught the projection (the two are different topics in different consumer groups).
//
// All three are nullable and additive: existing rows keep working untouched (NULL owner => no
// grant is attempted, NULL snapshot_at => any snapshot applies). IDEMPOTENT (IF NOT EXISTS).
// Ownership/grants/RLS: see migration 6 header.

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE selection_list_ref_index
      ADD COLUMN IF NOT EXISTS owner_id    TEXT,
      ADD COLUMN IF NOT EXISTS org_name    TEXT,
      ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMPTZ
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE selection_list_ref_index
      DROP COLUMN IF EXISTS snapshot_at,
      DROP COLUMN IF EXISTS org_name,
      DROP COLUMN IF EXISTS owner_id
  `);
}
