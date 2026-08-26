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
 * for). Two steps, BOTH gated on the same precondition (see the 2026-08-23
 * amendment below — they are NOT independent):
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
 * PRECONDITION on BOTH (a) and (b): the `ROOT_ORG_ID` row must exist. It is a
 * hard-coded constant, not a lookup, and migration 015 has two paths that
 * legitimately leave it absent (adopt-a-differently-identified platform org;
 * defer when no user exists). (a) verifies the row before inserting anything
 * that references it — an unverified reference is a 23503 that aborts the
 * migration chain and crash-loops the service on boot, which is exactly what
 * happened in prod on 2026-08-20 (#750). The pre-existing tests only ever ran
 * against a database where 015 had succeeded, so this path was never
 * exercised.
 *
 * 2026-08-23 AMENDMENT — (b) is now gated on the SAME precondition as (a).
 * Between #750/#751 (2026-08-20, commit c472efa6) and this amendment, (b)
 * ran unconditionally even when (a) skipped — on a database where the root
 * org does not exist, every `type='personal'` org got reclassified to
 * `type='organization'` with NO root-org membership to fall back on. That
 * stranded every affected user: `WorkspaceProvisioningGate.tsx` never finds
 * a `type='personal'` org and never reaches `ready`, and `ensurePersonalOrg`'s
 * idempotency check (`{ owner_id, type: 'personal' }`) misses and tries to
 * create a second personal org, which the `slug` unique constraint then
 * rejects. See the forward-repair migration
 * (`025_repair_personal_org_over_reclassification.ts`) for restoring rows
 * already damaged by the unconditional window — editing this file does NOT
 * re-run it on a database that already applied migration 022 (knex records
 * applied migrations by name), so this edit protects only databases that
 * have not yet run 022; already-affected production rows need the forward
 * repair migration.
 *
 * DEPLOY NOTE: `master` is deploy-on-push and this migration runs on deploy —
 * land in a deploy window (`deploy-window` label, FF-EPIC-17-S2 DoD).
 */
export async function up(knex: Knex): Promise<void> {
  // (a) Backfill root membership for every user lacking one.
  //
  // PRECONDITION: the root org row must actually exist. `ROOT_ORG_ID` is a
  // hard-coded constant, not a lookup, and migration 015 has two paths that
  // legitimately leave the row ABSENT — it adopts a pre-existing platform org
  // under a different id, and it defers entirely when there is no user yet.
  // Neither is an error there, but inserting memberships that reference a
  // missing organization is a foreign-key violation (23503) that aborts the
  // migration chain and crash-loops the service on boot. Verify, don't assume:
  // a step that cannot tell "nothing to do" from "the thing I need is missing"
  // eventually reports success for the wrong reason.
  const rootOrg = await knex('organizations').where({ id: ROOT_ORG_ID }).first()
  if (!rootOrg) {
    const platform = await knex('organizations')
      .where({ type: 'platform' })
      .orderBy('created_at', 'asc')
      .first()
    console.error(
      `[022] SKIPPING root-membership backfill: organization ${ROOT_ORG_ID} does ` +
        'not exist. ' +
        (platform
          ? `The platform organization in this database is ${platform.id}, which ` +
            'migration 015 adopted rather than repointed. Resolve that first — ' +
            'until then every ROOT_ORG_ID call site misses.'
          : 'No platform organization exists at all; migration 015 deferred.') +
      ' Not inserting memberships that would violate' +
      ' organization_memberships_organization_id_foreign.'
    )
  } else {
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
  }

  // (b) Reclassify type='personal' -> type='organization'.
  //
  // GATED ON THE SAME PRECONDITION AS (a) — see #750/#751/prod incident
  // 2026-08-23. This step used to run unconditionally on the theory that it
  // was "independent of (a) and of the root org". That was the bug: the
  // whole point of root-membership backfill is that every user gets a
  // `organization_memberships` row in the root org to fall back on once
  // their personal-org classification is gone. Reclassifying `personal` ->
  // `organization` when (a) could not run (root org absent) strands the
  // user with NEITHER a `type='personal'` org NOR a root-org membership —
  // every consumer that keys off `type='personal'` (the frontend
  // provisioning gate, `ensurePersonalOrg`'s idempotency check) breaks, and
  // there is nothing to fall back to. Nothing deleted either way — this
  // only widens the guard, it does not change what (b) does when it runs.
  if (rootOrg) {
    const reclassifyResult = await knex.raw(
      `UPDATE organizations
         SET type = 'organization', updated_at = NOW()
       WHERE type = 'personal'`
    )
    console.log(
      `[022] personal-org reclassify: updated ${reclassifyResult.rowCount ?? 0} row(s)`
    )
  } else {
    console.error(
      `[022] SKIPPING personal-org reclassify: organization ${ROOT_ORG_ID} does not ` +
        'exist, so reclassifying away type=\'personal\' now would strand every ' +
        'affected user with neither a personal org nor a root-org membership. ' +
        'Will retry reclassify on a later boot once the root org exists.'
    )
  }
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
