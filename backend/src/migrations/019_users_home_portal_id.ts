import { Knex } from 'knex'
import { ROOT_ORG_ID } from './015_seed_root_platform_organization'

/**
 * FF-EPIC-11-S1 — `users.home_portal_id`, the tenant-scoped-identity foundation.
 *
 * Adds a nullable `users.home_portal_id` FK -> `portals.id`. `NULL` means "root /
 * platform user" — deliberately preserving today's (pre-epic) behavior for every
 * existing account rather than forcing a portal choice at migration time. Only a
 * user whose home organization resolves to a NON-root portal gets a non-null
 * value.
 *
 * `ON DELETE SET NULL` (not CASCADE): a portal going away must never delete the
 * user rows that call it home — it only orphans them back to the root/platform
 * default, same fail-safe direction as the NULL default itself.
 *
 * BACKFILL (idempotent, batched):
 *   For every existing user, resolve their EARLIEST active organization
 *   membership -> that organization -> the portal whose organization_id matches
 *   it. If that portal is the root portal (organization_id = ROOT_ORG_ID), or no
 *   membership/organization/portal resolves at all, the user is left/reset to
 *   NULL (root/platform), per the module doc above. This NEVER fails the
 *   migration and NEVER drops a row — an unresolvable user is simply left NULL.
 *
 *   Batched by a keyset walk over `users.id` (NOT a single giant UPDATE, and NOT
 *   OFFSET-based, which drifts under concurrent inserts) so this stays safe to
 *   run against a large, live `users` table without holding one huge lock.
 *
 * Additive + idempotent: the column add is `hasColumn`-guarded, and the backfill
 * recomputes the SAME deterministic value on every re-run (including via the
 * exported `backfillHomePortalIds` helper, callable directly by tests) — so
 * running `up` twice is an explicit no-op, not merely "doesn't error".
 */

const BATCH_SIZE = 500

export async function backfillHomePortalIds(
  knex: Knex,
  batchSize: number = BATCH_SIZE
): Promise<number> {
  const hasPortals = await knex.schema.hasTable('portals')
  const hasMemberships = await knex.schema.hasTable('organization_memberships')
  const hasOrganizations = await knex.schema.hasTable('organizations')
  if (!hasPortals || !hasMemberships || !hasOrganizations) {
    // Fresh-install ordering edge case (should not happen — 004/005/012 all
    // precede this migration) — self-heal by no-op rather than throw, mirroring
    // ensureRootPortal's fresh-install tolerance.
    return 0
  }

  let lastId: string | null = null
  let touched = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let idQuery = knex('users').select('id').orderBy('id', 'asc').limit(batchSize)
    if (lastId) idQuery = idQuery.where('id', '>', lastId)
    const rows: Array<{ id: string }> = await idQuery

    if (rows.length === 0) break
    const ids = rows.map(r => r.id)

    // For each user in this batch, resolve to the portal of the organization
    // backing their EARLIEST active membership (joined_at, tiebreak created_at).
    // A resolved portal whose organization IS the root org is written back as
    // NULL (root/platform, same as "unresolvable") rather than the root portal's
    // id — NULL is the single canonical "no tenant portal" representation used
    // everywhere else in this epic (scopeToPortal, authenticateToken's legacy
    // binding, etc).
    await knex.raw(
      `
      UPDATE users u
      SET home_portal_id = resolved.portal_id
      FROM (
        SELECT DISTINCT ON (om.user_id)
          om.user_id AS user_id,
          p.id AS portal_id
        FROM organization_memberships om
        JOIN organizations o ON o.id = om.organization_id
        JOIN portals p ON p.organization_id = o.id
        WHERE om.user_id = ANY(?)
          AND om.status = 'active'
          AND p.organization_id != ?
        ORDER BY om.user_id, om.joined_at ASC NULLS LAST, om.created_at ASC
      ) resolved
      WHERE u.id = resolved.user_id
      `,
      [ids, ROOT_ORG_ID]
    )

    // Any user in this batch that did NOT resolve to a non-root portal (no
    // membership, membership only to orgs with no portal, or a root-portal
    // membership) is explicitly reset to NULL — makes the backfill idempotent
    // even if a PRIOR run (or manual data change) left a stale value, and
    // covers the "unresolvable org -> null" edge deterministically rather than
    // relying on the column's default only applying once.
    await knex('users')
      .whereIn('id', ids)
      .whereNotIn('id', function () {
        this.select('om.user_id')
          .from('organization_memberships as om')
          .join('organizations as o', 'o.id', 'om.organization_id')
          .join('portals as p', 'p.organization_id', 'o.id')
          .where('om.status', 'active')
          .whereNot('p.organization_id', ROOT_ORG_ID)
      })
      .update({ home_portal_id: null })

    touched += ids.length
    lastId = ids[ids.length - 1]
    if (rows.length < batchSize) break
  }

  return touched
}

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('users', 'home_portal_id')
  if (!hasColumn) {
    await knex.schema.alterTable('users', table => {
      table
        .string('home_portal_id', 44)
        .nullable()
        .references('id')
        .inTable('portals')
        .onDelete('SET NULL')
    })
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS users_home_portal_id_idx ON users (home_portal_id)`
    )
  }

  await backfillHomePortalIds(knex)
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('users', 'home_portal_id')
  if (hasColumn) {
    await knex.raw(`DROP INDEX IF EXISTS users_home_portal_id_idx`)
    await knex.schema.alterTable('users', table => {
      table.dropColumn('home_portal_id')
    })
  }
}
