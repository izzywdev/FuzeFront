// Migration 13: `suspended_at` on the org projection - the platform organization's WRITE suspension.
//
// A legitimate `identity.org.deleted` (soft deactivation) or `identity.org.updated {isActive:false}` for the platform
// org must not delete data or take the common lists away from every tenant (reads/resolve stay available), but its
// former administrators must stop being able to publish or change them. The consumers therefore record a SUSPENDED
// state here instead of acting on the org's rows: while `suspended_at IS NOT NULL` the platform-write gates
// (publish_platform, platform list/item mutations, platform purge, platform seeding) refuse, consulted fresh per
// request. A legitimate re-activation (`org.updated`/`org.created` with is_active=true) clears it.
//
// Two columns:
//   suspended_at        when (wall clock) the suspension was recorded. NULL = not suspended.
//   suspended_event_at  the envelope `occurredAt` (clamped to now) of the deactivation that suspended it - the ORDERING
//                       clock of the suspend/resume state machine: an activation resumes only if it is not older than
//                       this, and a deactivation suspends only if it is strictly newer than the newest snapshot
//                       already applied (`snapshot_at`). The lifecycle topics have separate consumer groups, so events
//                       arrive out of order; without this a stale deactivation could suspend writes forever.
//
// Nullable, additive, IDEMPOTENT.

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE selection_list_ref_index ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS suspended_event_at TIMESTAMPTZ`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE selection_list_ref_index DROP COLUMN IF EXISTS suspended_event_at, DROP COLUMN IF EXISTS suspended_at`);
}
