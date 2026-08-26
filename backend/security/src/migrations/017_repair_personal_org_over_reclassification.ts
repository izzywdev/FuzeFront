import { Knex } from 'knex'

/**
 * Forward repair for the personal-org over-reclassification incident
 * (2026-08-23, prod). Security-service copy of `backend/src/migrations/
 * 025_repair_personal_org_over_reclassification.ts` — kept consistent per
 * the epic's "mirror into the non-live backend copy" DoD (security-service
 * is the LIVE/authoritative provisioning path; both backends deploy per
 * `release.yml`, so both must reconcile the same data).
 *
 * BACKGROUND: migration 015's step (b) reclassified `type='personal'` ->
 * `type='organization'` UNCONDITIONALLY, even on databases where step (a)
 * (root-membership backfill) had to skip because `ROOT_ORG_ID` did not exist
 * — which is the case in production (#750). Every affected user therefore
 * lost their `type='personal'` classification with no root-org membership
 * to fall back on: `WorkspaceProvisioningGate.tsx` never finds a
 * `type='personal'` org and the workspace "disappears" from the user's
 * perspective, and `ensurePersonalOrg`'s idempotency check
 * (`{ owner_id, type: 'personal' }`) misses on next login and tries to
 * create a second personal org.
 *
 * NO DATA WAS DELETED by the bug — the rows are intact with the wrong
 * `type`. This migration does NOT create new workspaces (that would strand
 * the real one behind a fresh, empty duplicate); it restores the `type` on
 * the rows the reclassify UPDATE touched incorrectly.
 *
 * IDENTIFYING THE AFFECTED ROWS: `ensurePersonalOrg` (organizationProvisioning.ts)
 * always stamps `metadata: { personal: true }` on the row it creates, and
 * nothing else writes that metadata shape. A row with `type='organization'`
 * AND `metadata->>'personal' = 'true'` is therefore precisely a
 * personal org that migration 015 incorrectly reclassified — never a
 * legitimately-created regular organization (those never get that metadata
 * key at all).
 *
 * THE COLLISION CASE: the partial unique index `uq_personal_org_per_owner`
 * (`ON organizations (owner_id) WHERE type = 'personal'`, from
 * `009_provisioning_backbone.ts`) allows at most one `type='personal'` row
 * per owner. If a user has, since the incident, somehow acquired ANOTHER
 * `type='personal'` org for the same owner (e.g. a manually-created
 * replacement workspace), restoring the original row's type would collide
 * with it. We resolve this explicitly, never silently:
 *   - if that other row is GENUINELY EMPTY (no memberships besides the
 *     owner's own, no app installs, no invitations, no linked portal, no
 *     owned apps) it is the accidental duplicate and is removed so the
 *     restore can proceed;
 *   - if it has ANY content, the restore for that owner is SKIPPED and
 *     logged for manual reconciliation — we never delete an org that has
 *     members, installs, or content, full stop.
 *
 * IDEMPOTENT: the WHERE clause (`type='organization' AND metadata->>'personal'
 * = 'true'`) matches zero rows once every affected row has been restored, so
 * re-running `up()` is a no-op on the second pass (skipped rows stay skipped
 * and are re-logged, which is intentional — they still need a human).
 *
 * `down()` is intentionally a no-op / irreversible, matching 022/015: once a
 * row is restored to `type='personal'` it is indistinguishable from one that
 * was always `type='personal'`, so there is nothing safe to revert to.
 */

/** Tables that, if they reference a duplicate personal org, disqualify it from being "empty". */
async function personalOrgHasContent(
  knex: Knex,
  orgId: string,
  ownerId: string
): Promise<boolean> {
  const checks: Promise<boolean>[] = []

  // Any membership row other than the owner's own automatic 'owner' row.
  checks.push(
    knex('organization_memberships')
      .where({ organization_id: orgId })
      .andWhereNot({ user_id: ownerId })
      .first()
      .then(row => !!row)
  )

  // The following tables don't exist in every backend copy of this schema
  // (e.g. the security service has no `apps`/`app_installations`/`portals`
  // tables) — guard each with hasTable so this migration runs safely in
  // both backends.
  if (await knex.schema.hasTable('app_installations')) {
    checks.push(
      knex('app_installations')
        .where({ organization_id: orgId })
        .first()
        .then(row => !!row)
    )
  }
  if (await knex.schema.hasTable('organization_invitations')) {
    checks.push(
      knex('organization_invitations')
        .where({ organization_id: orgId })
        .first()
        .then(row => !!row)
    )
  }
  if (await knex.schema.hasTable('portals')) {
    checks.push(
      knex('portals')
        .where({ organization_id: orgId })
        .first()
        .then(row => !!row)
    )
  }
  if (await knex.schema.hasTable('apps')) {
    checks.push(
      knex('apps')
        .where({ organization_id: orgId })
        .first()
        .then(row => !!row)
    )
  }

  const results = await Promise.all(checks)
  return results.some(Boolean)
}

export async function up(knex: Knex): Promise<void> {
  const affected = await knex('organizations')
    .where({ type: 'organization' })
    .whereRaw("metadata->>'personal' = 'true'")
    .orderBy('created_at', 'asc')
    .select('id', 'owner_id')

  let restored = 0
  let duplicatesRemoved = 0
  let skipped = 0

  for (const row of affected) {
    await knex.transaction(async trx => {
      // Re-fetch and lock inside the transaction — a prior iteration in this
      // same run may have already restored a sibling row for the same owner
      // (see the collision handling below), or a concurrent boot may have
      // already handled this row.
      const current = await trx('organizations')
        .where({ id: row.id })
        .forUpdate()
        .first()
      if (!current || current.type !== 'organization') return
      const metadata =
        typeof current.metadata === 'string'
          ? JSON.parse(current.metadata || '{}')
          : current.metadata || {}
      if (metadata.personal !== true) return

      const duplicate = await trx('organizations')
        .where({ owner_id: current.owner_id, type: 'personal' })
        .andWhereNot({ id: current.id })
        .first()

      if (duplicate) {
        const hasContent = await personalOrgHasContent(
          trx as unknown as Knex,
          duplicate.id,
          duplicate.owner_id
        )
        if (hasContent) {
          console.warn(
            `[017] SKIPPING restore for organization ${current.id} ` +
              `(owner ${current.owner_id}): a duplicate personal org ` +
              `${duplicate.id} already exists and has members/installs/` +
              'content. Manual reconciliation required — refusing to ' +
              'delete a non-empty organization.'
          )
          skipped++
          return
        }
        await trx('organizations').where({ id: duplicate.id }).del()
        duplicatesRemoved++
        console.log(
          `[017] removed empty duplicate personal org ${duplicate.id} ` +
            `(owner ${current.owner_id}) to make way for restoring ` +
            `${current.id}`
        )
      }

      await trx('organizations')
        .where({ id: current.id })
        .update({ type: 'personal', updated_at: trx.fn.now() })
      restored++
    })
  }

  console.log(
    `[017] personal-org over-reclassification repair: restored ${restored} ` +
      `row(s), removed ${duplicatesRemoved} empty duplicate(s), skipped ` +
      `${skipped} (duplicate has content — needs manual reconciliation)`
  )
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible / non-destructive: once a row is restored to
  // `type='personal'` it is indistinguishable from one that was always
  // `type='personal'`, so there is nothing safe to revert.
}
