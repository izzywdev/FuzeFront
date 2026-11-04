import { Knex } from 'knex'

/**
 * FFRNT-379 / S4 — model the internal `executive` app as a ROOT-ORG-OWNED
 * `private` app so the SERVER's visibility rule restricts it.
 *
 * Until now the executive restriction was a FRONTEND-ONLY hardcode
 * (`app.slug === 'executive'` in AppSelector/SidePanel/ApplicationsPage/
 * DashboardPage) — a latent BOLA gap, because the API returned the app to any
 * caller the generic visibility rule allowed. The owner ruled that no `platform`
 * visibility tier is needed: platform admins (owner/admin of the root org) plus a
 * root-org-owned `private` app already express "platform-internal". With
 * `fuzefront.app-registry.private-owner-only` ON, `private` is readable only by
 * the app's creator, the root org's owner, or a platform admin.
 *
 * Updates the `organization_id` + `visibility` columns AND the stored manifest
 * JSON's `visibility` so they never drift (list() reads the column; canRead reads
 * the manifest). Idempotent; a no-op if the row is absent. `down` restores
 * nothing (the prior value is not recoverable and `organization` is not safer).
 *
 * NOTE: the executive product self-registers and re-PUTs its manifest on every
 * pod start; its own registration manifest must also declare
 * `visibility: "private"` (cross-repo follow-up) or this row is re-widened.
 */

const SLUG = 'executive'
// Canonical root-org id (see app-registry/service.ts ROOT_ORG_ID; migration 011
// also inlines it because migrations cannot import service code).
const ROOT_ORG_ID = '00000000-0000-0000-0000-000000000010'

export async function up(knex: Knex): Promise<void> {
  const app = await knex('apps').where('slug', SLUG).first()
  if (!app) {
    console.log(`[022] ${SLUG}: no row present — nothing to update`)
    return
  }

  let manifest: Record<string, any> | null = null
  try {
    manifest = typeof app.manifest === 'string' ? JSON.parse(app.manifest) : app.manifest
  } catch {
    manifest = null
  }

  const updateData: Record<string, unknown> = {
    organization_id: ROOT_ORG_ID,
    visibility: 'private',
    updated_at: new Date(),
  }
  if (manifest) {
    manifest.visibility = 'private'
    updateData.manifest = JSON.stringify(manifest)
  }

  await knex('apps').where('id', app.id).update(updateData)
  console.log(`[022] ${SLUG}: root-org-owned, visibility='private'`)
}

export async function down(): Promise<void> {
  // Intentionally a no-op: see header.
}
