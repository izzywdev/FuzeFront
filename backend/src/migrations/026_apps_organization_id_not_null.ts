import { Knex } from 'knex'
import { ROOT_ORG_ID } from './015_seed_root_platform_organization'

// Owner ruling 2026-08-25 (portal-registration-gap investigation): "I think
// there should be no app without orgid. at the minimum fuzefront itself the
// root org is the orgid for our own apps. like google owns docs, sheets,
// etc." An org-less `apps` row was never a deliberate feature — see
// backend/applications/src/migrations/011_apps_organization_id_not_null.ts,
// this migration's sibling in the applications-service's OWN migration tree
// against the SAME shared `apps` table (this repo's schema for that table
// has historically been duplicated across both trees — see e.g. this
// service's 006_update_apps_for_organizations.ts and the applications
// service's 002_update_apps_for_organizations.ts, which apply the identical
// DDL). Kept in lock-step here for the same reason: whichever service's
// migrations happen to run first against a given database does the real
// work, and the other is a no-op — SET DEFAULT / SET NOT NULL on an
// already-conforming column raises nothing.
//
// `backend/src/routes/apps.ts`'s `scopeAppsQuery` is reconciled to match the
// production app-registry rule in the SAME change that adds this migration
// — see that file's own comment for the query-side half.

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('apps', 'organization_id')
  if (!hasColumn) {
    throw new Error(
      'apps.organization_id does not exist — 006_update_apps_for_organizations must run first'
    )
  }

  // This service is the one that SEEDS the root org (migration 015, in this
  // same tree) — unlike the applications-service's copy of this migration,
  // there is no cross-service ordering hazard to guard against here, but the
  // assertion stays for the same reason: fail loudly with a clear cause
  // instead of a bare FK-violation stack trace if that invariant is ever
  // broken by a future change.
  const root = await knex('organizations').where({ id: ROOT_ORG_ID }).first()
  if (!root) {
    throw new Error(
      `organizations.${ROOT_ORG_ID} (the platform root org) does not exist yet — ` +
        '015_seed_root_platform_organization must run before this one.'
    )
  }

  const backfilled = await knex('apps')
    .whereNull('organization_id')
    .update({ organization_id: ROOT_ORG_ID })
  if (backfilled > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[026] backfilled ${backfilled} org-less app(s) to the platform root org ${ROOT_ORG_ID}`
    )
  }

  await knex.raw(`ALTER TABLE apps ALTER COLUMN organization_id SET DEFAULT '${ROOT_ORG_ID}'::uuid`)
  await knex.raw('ALTER TABLE apps ALTER COLUMN organization_id SET NOT NULL')
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE apps ALTER COLUMN organization_id DROP NOT NULL')
  await knex.raw('ALTER TABLE apps ALTER COLUMN organization_id DROP DEFAULT')
  // Deliberately does NOT un-backfill rows back to NULL — see the sibling
  // applications-service migration's down() for why.
}
