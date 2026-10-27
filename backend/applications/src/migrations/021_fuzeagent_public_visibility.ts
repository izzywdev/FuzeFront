import { Knex } from 'knex'

/**
 * Make FuzeAgent (`fuzeagent`) PUBLIC so individual users — solo developers in
 * their personal space — can see and adopt it.
 *
 * WHY: FuzeAgent's governance (APP_GOVERNANCE in app-registry/app-governance.ts)
 * is already `scopeLevel: 'both'`, default-installed, and CORE on personal
 * (not removable) — the explicit intent that every user gets it on their
 * personal space. But its registry row carried `visibility: 'organization'`
 * from the original built-in seed, and the read filter
 * (service.ts `isVisibleTo` / `list`) hides an 'organization' app from anyone
 * who is not an ACTIVE member of the owning (root) org. So a solo developer
 * never saw the app the governance says they own. The two layers disagreed;
 * this aligns `visibility` with the governance intent.
 *
 * upsertBuiltin early-returns on an already-registered row, so the builtins.ts
 * change alone is inert on an existing environment (prod) — this migration
 * updates the live row. A fresh environment is seeded correctly by
 * upsertBuiltin from the updated builtins.ts.
 *
 * Updates BOTH the `visibility` column (used by the list query's
 * `whereIn('visibility', …)`) AND the stored `manifest` JSON's `visibility`
 * (used by `isVisibleTo`, the frontend, and re-register), so the two never
 * drift. `scope_level` and the governance columns are left untouched — they are
 * already correct ('both', core-on-personal).
 *
 * Idempotent: a no-op if the row is already public or absent. Mirrors the
 * read-parse-update shape of migration 017 (fuzesocial).
 */

const SLUG = 'fuzeagent'

export async function up(knex: Knex): Promise<void> {
  const app = await knex('apps').where('slug', SLUG).first()
  if (!app) {
    console.log(`[021] ${SLUG}: no row present — nothing to update (fresh env seeds via upsertBuiltin)`)
    return
  }

  let manifest: Record<string, any> | null = null
  try {
    manifest = typeof app.manifest === 'string' ? JSON.parse(app.manifest) : app.manifest
  } catch {
    manifest = null
  }

  const updateData: Record<string, unknown> = {
    visibility: 'public',
    updated_at: new Date(),
  }

  if (manifest) {
    manifest.visibility = 'public'
    updateData.manifest = JSON.stringify(manifest)
  } else {
    console.log(
      `[021] ${SLUG}: manifest jsonb unreadable — visibility column set to 'public', but the host reads the manifest, so this row still needs a re-register`
    )
  }

  await knex('apps').where('id', app.id).update(updateData)
  console.log(`[021] ${SLUG}: visibility set to 'public' (column${manifest ? ' + manifest' : ''})`)
}

export async function down(knex: Knex): Promise<void> {
  // Revert to the prior 'organization' visibility (column + manifest).
  const app = await knex('apps').where('slug', SLUG).first()
  if (!app) return

  let manifest: Record<string, any> | null = null
  try {
    manifest = typeof app.manifest === 'string' ? JSON.parse(app.manifest) : app.manifest
  } catch {
    manifest = null
  }

  const updateData: Record<string, unknown> = {
    visibility: 'organization',
    updated_at: new Date(),
  }

  if (manifest) {
    manifest.visibility = 'organization'
    updateData.manifest = JSON.stringify(manifest)
  }

  await knex('apps').where('id', app.id).update(updateData)
}
