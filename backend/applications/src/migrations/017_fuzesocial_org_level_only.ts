import { Knex } from 'knex'

/**
 * Enforces organization-only and whole-org installation for FuzeSocial (`fuzesocial`).
 *
 * 1. Updates `apps.scope_level = 'organization'` and `visibility = 'organization'`.
 * 2. In `manifest`: sets `scopeLevel: 'organization'`, `visibility: 'organization'`,
 *    `requiresOrgContext: true`, `installMode: 'everyone'`, and `orgLevelOnly: true`.
 * 3. Revokes/deletes any personal installations (`scope = 'personal'`) and
 *    any single-user installations (`install_mode = 'self'`).
 */

const SLUG = 'fuzesocial'

export async function up(knex: Knex): Promise<void> {
  const app = await knex('apps').where('slug', SLUG).first()
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
      manifest.installMode = 'everyone'
      manifest.orgLevelOnly = true
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
    console.log(`[017] ${SLUG}: updated scope_level='organization', installMode='everyone', orgLevelOnly=true`)

    if (await knex.schema.hasTable('app_installations')) {
      const revoked = await knex('app_installations')
        .where('app_id', app.id)
        .andWhere(builder => {
          builder.where('scope', 'personal').orWhere('install_mode', 'self')
        })
        .del()

      if (revoked > 0) {
        console.log(`[017] ${SLUG}: revoked ${revoked} non-org / self installation(s)`)
      }
    }
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Irreversible tightening
}
