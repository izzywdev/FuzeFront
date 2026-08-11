import { Knex } from 'knex'
import { ROOT_ORG_ID } from './015_seed_root_platform_organization'

/**
 * FF-EPIC-17-S2 — reconcile existing data to the root-membership model.
 * Monolith copy of `backend/security/src/migrations/
 * 015_root_membership_backfill_and_personal_org_reclassify.ts` — kept
 * consistent per the epic's "mirror into the non-live backend copy" DoD
 * (security-service is the LIVE/authoritative provisioning path; both
 * backends deploy per `release.yml`, so both must reconcile the same data).
 *
 * Runs UNCONDITIONALLY (migrations are never flag-gated — see
 * `fuzefront.identity.root-membership` in `organizationProvisioning.ts` for
 * the flag that gates the PROVISIONING *behavior* this migration backfills
 * for). Two independent, idempotent steps:
 *
 *  (a) BACKFILL — every user without an existing `organization_memberships`
 *      row in the root org (ROOT_ORG_ID, any role) gets one with
 *      `role='member', status='active'`. A user who already has a row (most
 *      commonly the root org's own owner, seeded by migration 015) is left
 *      untouched — this is a "fill the gap", not a "reset everyone to
 *      member" migration. A user whose org can't be resolved still isn't
 *      skipped outright — root membership is universal and never depends on
 *      org resolution.
 *
 *  (b) RECLASSIFY — every `organizations` row with `type='personal'` becomes
 *      `type='organization'`. Non-destructive: nothing is deleted, no other
 *      column changes, and personal-scope app installs are keyed to
 *      `userId` (not the org id), so they are unaffected. The `'personal'`
 *      enum value is kept for back-compat (Postgres cannot drop an enum
 *      value) but is no longer written once the flag is ON.
 *
 * IDEMPOTENT: (a) is an INSERT..SELECT guarded by NOT EXISTS on the unique
 * (user_id, organization_id) pair, PLUS `ON CONFLICT DO NOTHING` as a second
 * belt-and-braces guard against a concurrent insert of the same pair between
 * the SELECT and the INSERT. (b) is a plain UPDATE whose WHERE clause matches
 * zero rows once every personal org has already been reclassified. Both are
 * safe to run any number of times with no diff after the first successful
 * run — verified by `backend/security/tests/
 * migrations.rootMembershipBackfill.test.ts` (run + re-run on a scratch DB);
 * this monolith copy is byte-identical SQL, so the same proof applies.
 *
 * DEPLOY NOTE: `master` is deploy-on-push and this migration runs on deploy —
 * land in a deploy window (`deploy-window` label, FF-EPIC-17-S2 DoD).
 */
export async function up(knex: Knex): Promise<void> {
  // (a) Backfill root membership for every user lacking one.
  const backfillResult = await knex.raw(
    `INSERT INTO organization_memberships
       (id, user_id, organization_id, role, status, joined_at, permissions, metadata)
     SELECT gen_random_uuid(), u.id, ?, 'member', 'active', NOW(), '{}'::jsonb, '{}'::jsonb
     FROM users u
     WHERE NOT EXISTS (
       SELECT 1 FROM organization_memberships om
       WHERE om.user_id = u.id AND om.organization_id = ?
     )
     ON CONFLICT (user_id, organization_id) DO NOTHING`,
    [ROOT_ORG_ID, ROOT_ORG_ID]
  )
  console.log(
    `[022] root-membership backfill: inserted ${backfillResult.rowCount ?? 0} row(s)`
  )

  // (b) Reclassify type='personal' -> type='organization'. Nothing deleted.
  const reclassifyResult = await knex.raw(
    `UPDATE organizations
       SET type = 'organization', updated_at = NOW()
     WHERE type = 'personal'`
  )
  console.log(
    `[022] personal-org reclassify: updated ${reclassifyResult.rowCount ?? 0} row(s)`
  )
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible / non-destructive on purpose:
  //  - We cannot distinguish a backfilled root membership from one a user
  //    legitimately created after this migration ran, so "undo" would risk
  //    deleting real memberships.
  //  - Reclassified orgs are, by design, never reverted to 'personal' — that
  //    was the whole point of the (recommended, non-destructive) reclassify
  //    strategy over delete-if-empty. See FF-EPIC-17-S2's Definition of Done.
}
