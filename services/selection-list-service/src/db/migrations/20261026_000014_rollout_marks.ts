// Migration 14: the durable one-shot markers of the SL9 rollout data jobs (src/rollout/*,
// docs/runbooks/selection-lists-rollout.md section 10).
//
// WHY. `visibility-org` (design record 9.4) turns every seeded `private` list into `org`. Once shared lists are on, an owner
// may set such a list back to `private` on purpose; a later run of the job must NOT undo that. The first guard (a user's
// `visibility.changed` event in the outbox) ages out with the outbox (delivered rows are pruned after 168 h), so it cannot be
// the only one. This table is the guard that does not age: the job writes one row per organization IN THE SAME TRANSACTION
// as the flips (under the organization outbox lock) and never touches a marked organization again.
//
// WHAT
//   selection_list_rollout_marks
//     job              TEXT        the job name ('visibility-org').
//     organization_id  TEXT        the organization's canonical `org_...` TypeID (one mark per org, whichever rendering its
//                                  lists are stored under). Cross-service reference: declared in data-contract.json
//                                  (onDelete cascade; the HARD org purge deletes it, the soft cascade keeps it so that a
//                                  restore does not re-flip).
//     completed_at     TIMESTAMPTZ when the job finished with this organization.
//     run_id           TEXT        the run that wrote it (also the correlation id suffix of its events), or 'manual'.
//     lists_changed    INTEGER     how many lists that run changed in the organization (informational).
//   PRIMARY KEY (job, organization_id): the insert is `ON CONFLICT DO NOTHING`, so a second writer is harmless.
//
// ADDITIVE and IDEMPOTENT (CREATE TABLE IF NOT EXISTS), reversible (down drops it). Owned and written ONLY by this service's
// jobs; nothing publishes it and no other service reads it. Ownership/grants/RLS: see migration 6 header.

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS selection_list_rollout_marks (
      job             TEXT        NOT NULL CHECK (job <> ''),
      organization_id TEXT        NOT NULL CHECK (organization_id <> ''),
      completed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      run_id          TEXT        NOT NULL CHECK (run_id <> ''),
      lists_changed   INTEGER     NOT NULL DEFAULT 0 CHECK (lists_changed >= 0),
      PRIMARY KEY (job, organization_id)
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS selection_list_rollout_marks');
}
