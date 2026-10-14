// Migration 13: `suspended_at` on the org projection - the platform organization's WRITE suspension.
//
// A legitimate `identity.org.deleted` (soft deactivation) or `identity.org.updated {isActive:false}` for the platform
// org must not delete data or take the common lists away from every tenant (reads/resolve stay available), but its
// former administrators must stop being able to publish or change them. The consumers therefore record a SUSPENDED
// state here instead of acting on the org's rows: while `suspended_at IS NOT NULL` the platform-write gates
// (publish_platform, platform list/item mutations, platform purge, platform seeding) refuse, consulted fresh per
// request. A legitimate re-activation (`org.updated`/`org.created` with is_active=true) clears it.
//
// Nullable, additive, IDEMPOTENT. NULL = not suspended.

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE selection_list_ref_index ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE selection_list_ref_index DROP COLUMN IF EXISTS suspended_at`);
}
