import { Knex } from 'knex'

/**
 * Security-service equivalent of `backend/src/migrations/015_seed_root_platform_organization.ts`.
 *
 * The monolith and security-service point at the SAME physical Postgres
 * database in every deployed environment (`deploy/helm/fuzefront/templates/
 * backend.yaml` and `security.yaml` both consume `.Values.database.name`), so
 * in practice this migration is almost always a no-op — the monolith's 015
 * already created the row by the time this runs. It exists so security-service
 * is correct standalone too (a fresh `fuzefront_security_*` test/dev database
 * that never ran the monolith's chain, e.g. `migrations.integration.test.ts`),
 * and so `ROOT_ORG_ID` has a security-service-local, statically-importable
 * source (mirrors the monolith's `import { ROOT_ORG_ID } from
 * '../migrations/015_seed_root_platform_organization'` pattern) for
 * `organizationProvisioning.ts`'s FF-EPIC-17-S1 root-membership upsert.
 *
 * `ON CONFLICT DO NOTHING` covers both the pkey and the slug unique index, so
 * whichever service's migration runs first wins and the other is a no-op —
 * never two competing platform orgs.
 */

// Bound to the monolith's ROOT_ORG_ID (backend/src/migrations/015). Changing
// this value orphans every Permit tenant / relationship tuple already keyed
// to it, and desyncs the two services' notion of "the root org".
export const ROOT_ORG_ID = '00000000-0000-0000-0000-000000000010'
const ROOT_ORG_SLUG = 'fuzefront'

export async function up(knex: Knex): Promise<void> {
  const already = await knex('organizations').where({ id: ROOT_ORG_ID }).first()
  if (already) {
    console.log('[014] root platform organization already present — nothing to do')
    return
  }

  // Adopt a pre-existing platform org rather than creating a second one.
  const existingPlatform = await knex('organizations')
    .where({ type: 'platform' })
    .orderBy('created_at', 'asc')
    .first()
  if (existingPlatform) {
    // NOT a benign no-op. `portals.ts`, `security.ts`'s org-tree walk,
    // `employeeRole.ts`'s ReBAC check and migration 015's backfill all
    // reference the LITERAL `ROOT_ORG_ID`, so a root org living under some
    // other id is a state the rest of the service cannot honour. Repointing is
    // not safe to do unattended (rows already reference the old id), so this
    // returns — but it must be VISIBLE rather than an info-level log that
    // reads like success. Resolving it is a deliberate data migration.
    console.error(
      `[014] UNSUPPORTED STATE: platform organization ${existingPlatform.id} exists ` +
        `but ${ROOT_ORG_ID} does not. Every ROOT_ORG_ID call site will miss it. ` +
        `NOT repointing automatically — rows already reference ${existingPlatform.id}. ` +
        `Root-org-dependent migrations will skip; resolve with a deliberate ` +
        `repoint-or-reparent migration.`
    )
    return
  }

  // No pre-existing user to own it yet (e.g. a schema-only test DB) — defer.
  // `runInternalProvision`'s root-membership upsert and 015 (S2 backfill) both
  // self-heal once a user exists, exactly like the monolith's ensureRootPortal().
  const owner = await knex('users').orderBy('created_at', 'asc').first()
  if (!owner) {
    console.log('[014] no users yet — root organization deferred')
    return
  }

  const result = await knex.raw(
    `INSERT INTO organizations
       (id, name, slug, parent_id, owner_id, type, settings, metadata, is_active, provisioning_state)
     VALUES (?, 'FuzeFront', ?, NULL, ?, 'platform', '{}'::jsonb, ?::jsonb, true, 'pending')
     ON CONFLICT DO NOTHING`,
    [ROOT_ORG_ID, ROOT_ORG_SLUG, owner.id, JSON.stringify({ root: true })]
  )

  // `rowCount === 0` means "I inserted nothing", NOT "the row I wanted is
  // there". The untargeted conflict clause above also swallows a conflict on
  // the `slug` unique index, which a DIFFERENT organization can hold — in which
  // case no row with ROOT_ORG_ID was created and the membership insert below
  // would violate `organization_memberships_organization_id_foreign` (23503).
  // Assert the postcondition instead of inferring it from the conflict.
  const root = await knex('organizations').where({ id: ROOT_ORG_ID }).first()
  if (!root) {
    const slugHolder = await knex('organizations').where({ slug: ROOT_ORG_SLUG }).first()
    console.error(
      `[014] FAILED to seed root platform organization ${ROOT_ORG_ID}: ` +
        (slugHolder
          ? `slug '${ROOT_ORG_SLUG}' is held by organization ${slugHolder.id} ` +
            `(type=${slugHolder.type}), so the INSERT was a no-op.`
          : 'the INSERT was a no-op and the row is still absent.') +
        ' Skipping the owner-membership insert, which would otherwise violate' +
        ' organization_memberships_organization_id_foreign.'
    )
    return
  }

  if (result.rowCount > 0) {
    console.log(`[014] created root platform organization ${ROOT_ORG_ID}`)
  } else {
    console.log(`[014] root platform organization ${ROOT_ORG_ID} already present`)
  }

  // Owner membership, so the root org is reachable through the same membership
  // path as every other org (GET /api/organizations joins on memberships).
  await knex.raw(
    `INSERT INTO organization_memberships
       (id, user_id, organization_id, role, status, joined_at, permissions, metadata)
     VALUES (gen_random_uuid(), ?, ?, 'owner', 'active', NOW(), '{}'::jsonb, '{}'::jsonb)
     ON CONFLICT DO NOTHING`,
    [owner.id, ROOT_ORG_ID]
  )
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible — see the monolith's 015 for the rationale
  // (deleting the root org orphans every Permit tuple keyed to it).
}
