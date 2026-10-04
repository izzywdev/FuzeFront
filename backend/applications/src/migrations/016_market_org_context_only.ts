import { Knex } from 'knex'

/**
 * Enforces organization-only installation and context for the `market` (FuzeMarket) app.
 *
 * Updates `apps.scope_level` to 'organization', `visibility` to 'organization',
 * and stamps `scopeLevel: 'organization'` and `requiresOrgContext: true` into
 * `manifest`.
 *
 * Any existing personal-scope installations for `market` / `fuzemarket` are revoked.
 */

const SLUGS = ['market', 'fuzemarket']

export async function up(knex: Knex): Promise<void> {
  for (const slug of SLUGS) {
    const app = await knex('apps').where('slug', slug).first()
    if (app) {
      let manifest: Record<string, any> | null = null
      try {
        manifest = typeof app.manifest === 'string' ? JSON.parse(app.manifest) : app.manifest
      } catch {
        manifest = null
      }

      if (manifest) {
        manifest.visibility = 'organization'
        manifest.scopeLevel = 'organization'
        manifest.requiresOrgContext = true
      }

      const updateData: Record<string, unknown> = {
        visibility: 'organization',
        scope_level: 'organization',
        updated_at: new Date(),
      }

      if (manifest) {
        updateData.manifest = JSON.stringify(manifest)
      }

      await knex('apps').where('id', app.id).update(updateData)
      console.log(`[016] ${slug}: updated scope_level='organization', requiresOrgContext=true`)

      // Clean up any stray personal-scope installations
      const deletedInstalls = await knex('app_installations')
        .where('app_id', app.id)
        .andWhere('scope', 'personal')
        .del()

      if (deletedInstalls > 0) {
        console.log(`[016] ${slug}: revoked ${deletedInstalls} personal installation(s)`)
      }
    }
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Irreversible tightening
}
