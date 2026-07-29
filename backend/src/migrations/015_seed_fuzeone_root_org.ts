import { Knex } from 'knex'

/**
 * Idempotently (re)create the **FuzeOne root organization** — the top of the
 * ReBAC org hierarchy.
 *
 * WHY THIS IS A MIGRATION AND NOT A SEED
 * --------------------------------------
 * `src/permit/schema.ts` and `src/utils/permit/resource-instances.ts` are both
 * written around "FuzeOne is the root/parent tenant; customer organizations are
 * its children" — `setOrganizationParent()` links a child to it and
 * `assignOrgAdminRebac()` grants staff `org-admin` **on the root org** so they
 * derive admin on every child through the `parent` relation.
 *
 * That whole model assumed a root organization row that nothing in Git ever
 * created. The concept existed only in the Permit schema and in comments: there
 * was no migration, no seed, and no constant — so on any freshly built database
 * (and in production) there is simply no organization to parent children to or
 * to grant staff admin on, and the hierarchy silently degrades to a flat list.
 *
 * Seeds cannot fix this: `initializeDatabase()` only calls `runSeeds()` when
 * `NODE_ENV !== 'production'`, so a seed never executes in prod. Migrations run
 * unconditionally on every backend start AND on every freshly built database,
 * which is exactly the durability property this row needs — the same reasoning
 * as `014_seed_platform_registrar_user`, which this migration depends on.
 *
 * Every statement is a no-op when its row already exists, so this is safe to
 * re-run and safe on databases where the org was created by hand.
 */

// Platform-reserved UUIDs. These are stable identifiers, not random ones:
// Permit relationship tuples (`Organization:<id>`) and any child org's
// `parent_id` are written against this value, so changing it orphans the whole
// hierarchy. It follows the low-numbered convention established by
// PLATFORM_REGISTRAR_ID (...0001) in migration 014.
const FUZEONE_ROOT_ORG_ID = '00000000-0000-0000-0000-000000000002'
const FUZEONE_ROOT_ORG_NAME = 'FuzeOne'
const FUZEONE_ROOT_ORG_SLUG = 'fuzeone'

// Owner of the root org. Deliberately the token-only service principal from
// migration 014 rather than any human: it is the one user row guaranteed to
// exist in EVERY environment including production, so the FK below can never
// abort boot. Humans are granted membership on top (see FUZEONE_ROOT_ADMIN_EMAILS).
const PLATFORM_REGISTRAR_ID = '00000000-0000-0000-0000-000000000001'

/**
 * Comma-separated list of existing user emails to grant `admin` membership on
 * the root org, e.g. `FUZEONE_ROOT_ADMIN_EMAILS=someone@example.com,other@example.com`.
 *
 * Env-driven rather than hard-coded: which humans administer the root tenant is
 * a per-deployment authorization decision and must not be baked into a migration
 * that runs in every environment. Unknown emails are skipped (never created) —
 * granting the root tenant to an address that has never signed in would be a
 * privilege-escalation footgun, so the user row must already exist.
 */
function rootAdminEmails(): string[] {
  return (process.env.FUZEONE_ROOT_ADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
}

export async function up(knex: Knex): Promise<void> {
  // Guard rather than assume. The split services share one `knex_migrations`
  // table with `disableMigrationsListValidation: true` (see core's database.ts),
  // so this chain can run against a database whose DDL was applied by the other
  // service's chain. Every statement here is written to be a no-op instead of
  // aborting startup when the table it touches is not present yet.
  if (!(await knex.schema.hasTable('organizations'))) {
    console.log('[015] organizations table not present — skipping FuzeOne root org seed')
    return
  }

  // `ON CONFLICT DO NOTHING` without a conflict target covers every unique
  // constraint on the table (both `organizations_pkey` and the unique `slug`),
  // so a root org already created by hand under either the id or the slug is
  // left untouched rather than raising.
  //
  // The `WHERE EXISTS` on the owner is what keeps this from ever failing boot:
  // `owner_id` is NOT NULL REFERENCES users(id), so if migration 014's service
  // principal were somehow absent a bare INSERT would abort the whole chain and
  // the backend would not start.
  const orgResult = await knex.raw(
    `INSERT INTO organizations (id, name, slug, parent_id, owner_id, type, settings, metadata, is_active)
     SELECT ?::uuid, ?, ?, NULL, ?::uuid, 'platform'::organization_type_enum, '{}'::jsonb, '{}'::jsonb, true
     WHERE EXISTS (SELECT 1 FROM users WHERE id = ?::uuid)
     ON CONFLICT DO NOTHING`,
    [
      FUZEONE_ROOT_ORG_ID,
      FUZEONE_ROOT_ORG_NAME,
      FUZEONE_ROOT_ORG_SLUG,
      PLATFORM_REGISTRAR_ID,
      PLATFORM_REGISTRAR_ID,
    ]
  )

  if (orgResult.rowCount > 0) {
    console.log(`[015] created FuzeOne root organization ${FUZEONE_ROOT_ORG_ID}`)
  } else {
    console.log('[015] FuzeOne root organization already present — nothing to do')
  }

  if (!(await knex.schema.hasTable('organization_memberships'))) {
    console.log('[015] organization_memberships table not present — skipping memberships')
    return
  }

  // Owner membership for the service principal. Without at least one membership
  // row the org exists but is invisible to `GET /api/organizations`, which lists
  // by membership — the org would be unreachable from the UI and look like the
  // seed had not run.
  await knex.raw(
    `INSERT INTO organization_memberships (user_id, organization_id, role, status, joined_at)
     SELECT ?::uuid, ?::uuid, 'owner'::membership_role_enum, 'active'::membership_status_enum, NOW()
     WHERE EXISTS (SELECT 1 FROM organizations WHERE id = ?::uuid)
       AND EXISTS (SELECT 1 FROM users WHERE id = ?::uuid)
     ON CONFLICT DO NOTHING`,
    [PLATFORM_REGISTRAR_ID, FUZEONE_ROOT_ORG_ID, FUZEONE_ROOT_ORG_ID, PLATFORM_REGISTRAR_ID]
  )

  // Human administrators, opt-in per deployment.
  for (const email of rootAdminEmails()) {
    const result = await knex.raw(
      `INSERT INTO organization_memberships (user_id, organization_id, role, status, joined_at)
       SELECT u.id, ?::uuid, 'admin'::membership_role_enum, 'active'::membership_status_enum, NOW()
       FROM users u
       WHERE LOWER(u.email) = ?
         AND EXISTS (SELECT 1 FROM organizations WHERE id = ?::uuid)
       ON CONFLICT DO NOTHING`,
      [FUZEONE_ROOT_ORG_ID, email, FUZEONE_ROOT_ORG_ID]
    )

    if (result.rowCount > 0) {
      console.log(`[015] granted FuzeOne root admin to ${email}`)
    } else {
      // Either already a member, or no such user — both are non-fatal, but say
      // which so a typo in FUZEONE_ROOT_ADMIN_EMAILS is visible in the logs
      // instead of failing silently.
      const exists = await knex('users').whereRaw('LOWER(email) = ?', [email]).first()
      console.log(
        exists
          ? `[015] ${email} already has FuzeOne root membership — nothing to do`
          : `[015] no user row for ${email} — root admin NOT granted (user must sign in first)`
      )
    }
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible. Child organizations reference this row via
  // `parent_id` (ON DELETE CASCADE) and Permit relationship tuples are written
  // against `Organization:00000000-0000-0000-0000-000000000002`, so deleting it
  // would cascade away every child tenant and orphan the authorization graph.
}
