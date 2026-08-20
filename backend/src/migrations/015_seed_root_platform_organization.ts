import { Knex } from 'knex'

/**
 * Idempotently (re)create the ROOT platform organization with a FIXED id.
 *
 * WHY THIS IS A MIGRATION AND NOT A SEED — same reasoning as 014.
 * `initializeDatabase()` only calls `runSeeds()` when `NODE_ENV !== 'production'`,
 * so a seed never executes in prod. Migrations run unconditionally on every
 * backend start AND on every freshly built database, which is exactly the
 * durability property a root-tenant row needs.
 *
 * WHAT THIS FIXES
 * ---------------
 * `ensureRootPortal()` previously resolved "the root organization" as *the
 * oldest `organizations` row of `type = 'platform'`*, creating one on the fly
 * owned by "the first user with admin in roles, else the first user". Its own
 * doc comment conceded "this codebase has no pre-existing single root org
 * concept". That made the platform root a CONVENTION rather than an IDENTITY:
 *
 *   - No stable key. Rebuild the DB (the 2026-07-24 Longhorn incident recreated
 *     the schema from scratch) and a *different* row becomes root. Anything
 *     that recorded the old id — Permit tenants, relationship tuples, portal
 *     rows — now points at an organization that is no longer the root.
 *   - Ownership fell to whichever user happened to sort first. In production
 *     that resolves to `platform-registrar` (migration 014 gives it
 *     roles ['admin','user'] and it is created before any human signs up) — a
 *     TOKEN-ONLY service principal with no password_hash that can never
 *     complete an interactive login. The platform root org was therefore owned
 *     by a principal no human can act as.
 *
 * Pinning the id here makes the root org durable and referenceable, in the same
 * way PLATFORM_REGISTRAR_ID makes the registrar durable.
 *
 * OWNERSHIP: this seeds the row owned by `platform-registrar` so the migration
 * has no dependency on a human existing yet. `ensureRootPortal()` promotes
 * ownership to a real administrator when one appears — see
 * `adoptRootOrganizationOwner()`. That keeps the row durable AND eventually
 * human-owned, instead of trading one problem for the other.
 */

// Bound to portalRepository.ROOT_ORG_ID. Changing this value orphans every
// Permit tenant / relationship tuple / portal row already keyed to it.
export const ROOT_ORG_ID = '00000000-0000-0000-0000-000000000010'
const ROOT_ORG_SLUG = 'fuzefront'
const PLATFORM_REGISTRAR_ID = '00000000-0000-0000-0000-000000000001'

export async function up(knex: Knex): Promise<void> {
  // The registrar is created by 014, which runs before this. If it is somehow
  // absent (a partially migrated DB), fall back to the oldest user; if there is
  // no user at all this is a no-op and ensureRootPortal() self-heals on a later
  // boot, exactly as before.
  const owner =
    (await knex('users').where({ id: PLATFORM_REGISTRAR_ID }).first()) ??
    (await knex('users').orderBy('created_at', 'asc').first())

  if (!owner) {
    console.log('[015] no users yet — root organization deferred to ensureRootPortal()')
    return
  }

  // Adopt a pre-existing platform org rather than creating a second one: an
  // environment that already ran the old ensureRootPortal() has a root org
  // under a random id, and inserting another would leave TWO platform orgs with
  // "oldest wins" deciding which is real.
  const existing = await knex('organizations')
    .where({ type: 'platform' })
    .orderBy('created_at', 'asc')
    .first()

  if (existing && existing.id !== ROOT_ORG_ID) {
    // NOT a benign no-op. ~30 call sites — `portals.ts`, `security.ts`'s org-tree
    // walk, `employeeRole.ts`'s ReBAC check, `scopeToPortal.ts`, migration 022's
    // backfill — reference the LITERAL `ROOT_ORG_ID`, so a root org living under
    // some other id is a state the rest of the codebase cannot honour. Repointing
    // is not safe to do unattended (rows already reference the old id), so this
    // returns, but it must be VISIBLE rather than an info-level log that reads
    // like success. Resolving it is a deliberate data migration.
    console.error(
      `[015] UNSUPPORTED STATE: platform organization ${existing.id} exists but ` +
        `${ROOT_ORG_ID} does not. Every ROOT_ORG_ID call site will miss it. ` +
        `NOT repointing automatically — rows already reference ${existing.id}. ` +
        `Root-org-dependent migrations will skip; resolve with a deliberate ` +
        `repoint-or-reparent migration.`
    )
    return
  }

  // `ON CONFLICT DO NOTHING` with no target covers both the pkey and the slug
  // unique index, so a re-run or a concurrent boot is a no-op rather than a 23505.
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
      `[015] FAILED to seed root platform organization ${ROOT_ORG_ID}: ` +
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
    console.log(`[015] created root platform organization ${ROOT_ORG_ID}`)
  } else {
    console.log(`[015] root platform organization ${ROOT_ORG_ID} already present`)
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
  // Intentionally irreversible: deleting the root organization would orphan the
  // root portal, every Permit tenant relationship keyed to it, and every child
  // org's `parent` tuple.
}
