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
  // same tree), which is why this used to assert unconditionally on the
  // premise that there is "no cross-service ordering hazard to guard against
  // here" — true, but irrelevant: it conflated "015 has run" with "015
  // created the row". #750 established that 015 has legitimate branches that
  // leave ROOT_ORG_ID absent even after it runs — adopting a pre-existing
  // platform org under a DIFFERENT id, a slug conflict, or no user yet to own
  // it — precisely because repointing/reparenting an existing root onto
  // ROOT_ORG_ID is a deliberate data migration, not something 015 does
  // unattended. Production is in exactly that state right now: the platform
  // org adopted from the 2026-07-29 rebuild lives under a different id, and
  // the repoint-or-reparent decision #750 asks for has not been made yet.
  // Throwing unconditionally here reintroduced the #750 crashloop one
  // migration later — this migration never gets marked applied, so it
  // retries and throws again on every single boot.
  //
  // Narrowed to match the fix already proven on the sibling migration
  // (applications-service's 011_apps_organization_id_not_null.ts,
  // 2026-08-26): only throw when there is something that would actually
  // violate apps_organization_id_foreign if backfilled to a still-absent id.
  // If there is nothing to backfill, skip instead — self-heals on a later
  // boot once 015 (or the deliberate repoint/reparent) seeds the root org.
  // scopeAppsQuery() may only drop its `organization_id IS NULL` arm once no
  // row can be null, and skipping here — rather than forcing NOT NULL early —
  // keeps that invariant intact: zero orphans means nothing could disappear.
  const root = await knex('organizations').where({ id: ROOT_ORG_ID }).first()
  if (!root) {
    const orphans = await knex('apps').whereNull('organization_id').count({ n: '*' }).first()
    const orphanCount = Number(orphans?.n ?? 0)
    if (orphanCount > 0) {
      throw new Error(
        `organizations.${ROOT_ORG_ID} (the platform root org) does not exist yet, and ` +
          `${orphanCount} org-less app(s) need backfilling to it — seed the platform root ` +
          'organization (015_seed_root_platform_organization, or the deliberate repoint/' +
          'reparent decision tracked in #750) before this migration can run.'
      )
    }
    // eslint-disable-next-line no-console
    console.log(
      `[026] platform root org ${ROOT_ORG_ID} not seeded yet and no org-less apps to backfill — ` +
        'skipping; will re-attempt on a later boot once the root org exists. Neither DEFAULT nor ' +
        'NOT NULL is set here: DEFAULT would point at a non-existent org and reintroduce the ' +
        'exact FK hazard this guard exists to prevent.'
    )
    return
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
