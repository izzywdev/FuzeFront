import { Knex } from 'knex'

// applications-service migration 011.
//
// Owner ruling 2026-08-25 (portal-registration-gap investigation): "I think
// there should be no app without orgid. at the minimum fuzefront itself the
// root org is the orgid for our own apps. like google owns docs, sheets,
// etc." An org-less `apps` row was never a deliberate feature — every
// first-party FuzeFront product ended up in that state simply because
// nothing ever set `organization_id` for it (registerBuiltin() hardcoded
// `null`; the app-registry's POST /apps route defaulted an omitted
// organizationId straight to `null` even for platform-admin callers). The
// visibility query then had to carry an `organization_id IS NULL` branch to
// keep those apps visible at all — a branch that, as a side effect, made
// ANY org-less row visible to EVERY caller regardless of its declared
// `visibility`. See backend/applications/src/app-registry/service.ts's
// `list()` for the query-side half of this fix, which REMOVES that branch;
// it must not run until this migration has guaranteed no row can be null,
// or apps that currently appear would silently disappear.
//
// This migration: backfill every existing org-less row to the platform root
// org, then make `organization_id` NOT NULL (with that root org as the
// column DEFAULT, so an insert path that forgets to set it explicitly lands
// on the root org instead of reintroducing the hole). The NOT NULL
// constraint is the part that makes this durable — a backfill alone is a
// point-in-time fix the next registration can silently undo.
//
// ROOT_ORG_ID is this service's own copy of the fixed id
// backend/src/migrations/015_seed_root_platform_organization.ts seeds and
// exports. Cross-service TS imports don't resolve (separate deployables),
// so every service that needs it re-declares the literal — same pattern as
// backend/applications/src/app-registry/service.ts's own copy (kept
// independent of that one deliberately: a migration must stay replayable on
// its own even if application code changes around it later) and
// backend/applications/tests/portal-catalog.integration.test.ts.
const ROOT_ORG_ID = '00000000-0000-0000-0000-000000000010'

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('apps', 'organization_id')
  if (!hasColumn) {
    // Never observed in practice — migration 002_update_apps_for_organizations
    // always adds this column first — but fail loudly rather than silently
    // no-op if a partially-migrated database somehow lacks it.
    throw new Error(
      'apps.organization_id does not exist — 002_update_apps_for_organizations must run first'
    )
  }

  // The root org itself must exist before anything can reference it or be
  // backfilled to it. It is seeded by a DIFFERENT service's migration tree
  // (backend/src's 015_seed_root_platform_organization) against the SAME
  // shared `organizations`/`apps` tables. If this service's migrations ever
  // run in an environment where that one has not, backfilling to a
  // still-absent id would violate apps_organization_id_foreign — fail loudly
  // with a clear cause instead of a mysterious later FK violation.
  const root = await knex('organizations').where({ id: ROOT_ORG_ID }).first()
  if (!root) {
    throw new Error(
      `organizations.${ROOT_ORG_ID} (the platform root org) does not exist yet — ` +
        'backend/src migration 015_seed_root_platform_organization must run before this one.'
    )
  }

  const backfilled = await knex('apps')
    .whereNull('organization_id')
    .update({ organization_id: ROOT_ORG_ID })
  if (backfilled > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[011] backfilled ${backfilled} org-less app(s) to the platform root org ${ROOT_ORG_ID}`
    )
  }

  // SET DEFAULT / SET NOT NULL on an already-conforming column is a no-op in
  // Postgres, not an error — safe to run every boot, exactly like every
  // other migration in this tree.
  await knex.raw(`ALTER TABLE apps ALTER COLUMN organization_id SET DEFAULT '${ROOT_ORG_ID}'::uuid`)
  await knex.raw('ALTER TABLE apps ALTER COLUMN organization_id SET NOT NULL')
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE apps ALTER COLUMN organization_id DROP NOT NULL')
  await knex.raw('ALTER TABLE apps ALTER COLUMN organization_id DROP DEFAULT')
  // Deliberately does NOT un-backfill rows back to NULL — that would
  // resurrect the exact hole this migration exists to close, and there is no
  // way to tell which rows were genuinely org-less before vs. root-owned by
  // this migration.
}
