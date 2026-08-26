import { Knex } from 'knex'

/**
 * Removes the `fuzequality` PHANTOM TILE from the app menu.
 *
 * WHAT WAS WRONG: builtins.ts seeded `fuzequality` as an `activated`,
 * menu-visible built-in whose `integration.remoteEntry` is
 * `/apps/fuzequality/assets/remoteEntry.js` — for a product that does not
 * exist. There is no `FuzeQuality` repository under any account this platform
 * can reach (verified 2026-08-25 against the full repo listing: 24 repos
 * across izzywdev, FuzeOne and fuzeone2026, none of them FuzeQuality). No
 * repo builds that bundle, no image serves it, no chart routes
 * `/apps/fuzequality/*` on the shell host. The tile rendered in every user's
 * menu and white-screened on click.
 *
 * WHY A MIGRATION IS REQUIRED, NOT JUST A builtins.ts EDIT: `upsertBuiltin` is
 * `if (existing) return` — deliberately, so a seed rerun never clobbers
 * operator state. The row is already registered in every environment that has
 * booted, so deleting the seed entry alone is inert on an existing database.
 * Exactly the same reasoning migration 010 spells out for `clock`.
 *
 * WHY SUSPEND RATHER THAN DELETE. `suspended` is the status the list contract
 * already hides ("Default: hide suspended apps", service.ts `list()`), and the
 * host UI asks for `status: 'activated'` explicitly
 * (frontend/src/platform/appRegistry.tsx). So suspending removes the tile from
 * the menu completely — which is the whole ask. Deleting would also work, but:
 *
 *   - `app_installations` CASCADE-deletes on the app row, so a delete silently
 *     destroys any per-organization install rows attached to it. They point at
 *     nothing today, but destroying rows in a production migration to fix a
 *     cosmetic defect is a bad trade.
 *   - Suspension is reversible by one `setStatus` call if FuzeQuality is ever
 *     actually built, and it leaves the row as evidence of what happened.
 *
 * The row keeps `builtin: true`. A suspended built-in is unusual, and that is
 * the point: it is a visible marker that something was seeded which should not
 * have been, rather than a silent absence.
 *
 * SCOPE GUARD: only touches a row whose remote_url is EXACTLY the known
 * phantom value. If an operator has since repointed this slug at something
 * real, the row is left alone and the migration says so — same conservative
 * shape as 010.
 */

const SLUG = 'fuzequality'
const PHANTOM_ENTRY = '/apps/fuzequality/assets/remoteEntry.js'

export async function up(knex: Knex): Promise<void> {
  const app = await knex('apps').where('slug', SLUG).first()
  if (!app) {
    console.log(`[011] ${SLUG}: no row present — nothing to do`)
    return
  }

  const current: string = app.remote_url ?? ''
  if (current !== PHANTOM_ENTRY) {
    console.log(
      `[011] ${SLUG}: remote_url is not the known phantom value, leaving untouched (${current || '<empty>'}). ` +
        `If this now points at a real deployment, also re-add the entry to builtins.ts.`
    )
    return
  }

  if (app.status === 'suspended') {
    console.log(`[011] ${SLUG}: already suspended — nothing to do`)
    return
  }

  await knex('apps').where('id', app.id).update({
    status: 'suspended',
    updated_at: new Date(),
  })

  console.log(
    `[011] ${SLUG}: status ${app.status} → suspended (phantom tile, no such product)`
  )
}

export async function down(knex: Knex): Promise<void> {
  // Reversible on purpose, unlike 010: nothing here is known-broken data, it is
  // a visibility decision. Rolling back restores the tile — which is only
  // correct if FuzeQuality now exists and something serves its bundle.
  const app = await knex('apps').where('slug', SLUG).first()
  if (!app) return
  if (app.remote_url !== PHANTOM_ENTRY) return

  await knex('apps').where('id', app.id).update({
    status: 'activated',
    updated_at: new Date(),
  })
  console.log(
    `[011] ${SLUG}: re-activated. NOTE: this tile white-screens unless a FuzeQuality ` +
      `deployment now serves ${PHANTOM_ENTRY}.`
  )
}
