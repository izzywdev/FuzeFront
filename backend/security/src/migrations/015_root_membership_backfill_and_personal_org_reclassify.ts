import { Knex } from 'knex'
import { ROOT_ORG_ID } from './014_seed_root_platform_organization'

/**
 * FF-EPIC-17-S2 — reconcile existing data to the root-membership model.
 *
 * Runs UNCONDITIONALLY (migrations are never flag-gated — see
 * `fuzefront.identity.root-membership` in `organizationProvisioning.ts` for
 * the flag that gates the PROVISIONING *behavior* this migration backfills
 * for). Two independent, idempotent steps:
 *
 *  (a) BACKFILL — every user without an existing `organization_memberships`
 *      row in the root org (ROOT_ORG_ID, any role) gets one with
 *      `role='member', status='active'`. A user who already has a row (most
 *      commonly the root org's own owner, seeded by migration 014) is left
 *      untouched — this is a "fill the gap", not a "reset everyone to
 *      member" migration. Runs even if `organizations` has no root row yet
 *      (defers to 0 rows matched, self-heals on a later boot once 014/015 or
 *      the monolith's chain seeds it) — a user whose org can't be resolved
 *      still isn't skipped outright, they simply pick up their root row the
 *      next time this migration (or the provisioning self-heal path) runs.
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
 * safe to run any number of times with no diff after the first successful run
 * — verified by `tests/migrations.rootMembershipBackfill.test.ts` (run + re-run
 * on a scratch DB).
 *
 * DEPLOY NOTE: `master` is deploy-on-push and this migration runs on deploy —
 * PRECONDITION on (a): the `ROOT_ORG_ID` row must exist. It is a hard-coded
 * constant, not a lookup, and migration 014 has two paths that legitimately
 * leave it absent (adopt-a-differently-identified platform org; defer when no
 * user exists). (a) verifies the row before inserting anything that references
 * it — an unverified reference is a 23503 that aborts the migration chain and
 * crash-loops the service on boot, which is exactly what happened in prod on
 * 2026-08-20 (#750). The pre-existing tests only ever ran against a database
 * where 014 had succeeded, so this path was never exercised.
 *
 * DEPLOY NOTE: `master` is deploy-on-push and this migration runs on deploy —
 * land in a deploy window (`deploy-window` label, FF-EPIC-17-S2 DoD).
 */
export async function up(knex: Knex): Promise<void> {
  // (a) Backfill root membership for every user lacking one.
  //
  // PRECONDITION: the root org row must actually exist. `ROOT_ORG_ID` is a
  // hard-coded constant, not a lookup, and migration 014 has two paths that
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
      `[015] SKIPPING root-membership backfill: organization ${ROOT_ORG_ID} does ` +
        'not exist. ' +
        (platform
          ? `The platform organization in this database is ${platform.id}, which ` +
            'migration 014 adopted rather than repointed. Resolve that first — ' +
            'until then every ROOT_ORG_ID call site misses.'
          : 'No platform organization exists at all; migration 014 deferred.') +
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
      `[015] root-membership backfill: inserted ${backfillResult.rowCount ?? 0} row(s)`
    )
  }

  // (b) Reclassify type='personal' -> type='organization'. Nothing deleted.
  // Independent of (a) and of the root org, so it runs either way.
  const reclassifyResult = await knex.raw(
    `UPDATE organizations
       SET type = 'organization', updated_at = NOW()
     WHERE type = 'personal'`
  )
  console.log(
    `[015] personal-org reclassify: updated ${reclassifyResult.rowCount ?? 0} row(s)`
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
