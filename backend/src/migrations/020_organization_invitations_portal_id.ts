import { Knex } from 'knex'

/**
 * FF-EPIC-11-S3 — binds an `organization_invitations` row to the portal it was
 * issued FOR, so an accept can be checked against the session's CURRENT portal
 * context (AC4 — a token accepted while resolved against a DIFFERENT portal
 * than it was issued for is rejected fail-closed, never granting membership).
 *
 * `portal_id` is nullable and mirrors `users.home_portal_id`'s (migration 019)
 * NULL convention: NULL means "issued from the root/platform portal (or the
 * `fuzefront.identity.portal-scoped-users` flag was OFF at invite-creation
 * time)" — never a distinct root-portal-id literal. This keeps the
 * "root == NULL" representation consistent across the whole epic, and means
 * every pre-S3 invitation row (backfilled to NULL by the column default)
 * behaves exactly like a root/platform invite, i.e. unchanged.
 *
 * `ON DELETE SET NULL` (not CASCADE) for the same reason as
 * `users.home_portal_id`: a portal going away must never delete or corrupt an
 * invitation row — it only falls back to the "unscoped/root" representation.
 *
 * Additive + idempotent (`hasColumn`-guarded) — no backfill needed since NULL
 * is already the correct value for every pre-existing row.
 */

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('organization_invitations', 'portal_id')
  if (!hasColumn) {
    await knex.schema.alterTable('organization_invitations', table => {
      table
        .string('portal_id', 44)
        .nullable()
        .references('id')
        .inTable('portals')
        .onDelete('SET NULL')
    })
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS organization_invitations_portal_id_idx ON organization_invitations (portal_id)`
    )
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('organization_invitations', 'portal_id')
  if (hasColumn) {
    await knex.raw(`DROP INDEX IF EXISTS organization_invitations_portal_id_idx`)
    await knex.schema.alterTable('organization_invitations', table => {
      table.dropColumn('portal_id')
    })
  }
}
