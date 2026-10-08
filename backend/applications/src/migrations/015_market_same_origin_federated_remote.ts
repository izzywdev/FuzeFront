import { Knex } from 'knex'

/**
 * Repairs the `market` (FuzeMarket) app's federated entry in the field the HOST
 * ACTUALLY READS: `manifest.integration.remoteEntry`.
 *
 * Before this migration:
 *   Production registry stored:
 *     remoteEntry: "https://fuzemarket.fuze.internal/dist/remoteEntry.js"
 *   which fails DNS resolution on the browser over the public edge.
 *
 * This migration repairs `manifest.integration.remoteEntry` to `/apps/market/remoteEntry.js`,
 * sets `scope: "market"`, `module: "./App"`, updates the legacy columns (`remote_url`, `url`, `scope`, `module`),
 * and suspends any orphaned duplicate `fuzemarket` row if the canonical `market` row is present and activated.
 */

const SLUG = 'market'
const CORRECT_ENTRY = '/apps/market/remoteEntry.js'
const SCOPE = 'market'
const MODULE = './App'
const ROUTING_PATH = '/app/market'

export async function up(knex: Knex): Promise<void> {
  const app = await knex('apps').where('slug', SLUG).first()
  if (app) {
    let manifest: Record<string, any> | null = null
    try {
      manifest = typeof app.manifest === 'string' ? JSON.parse(app.manifest) : app.manifest
    } catch {
      manifest = null
    }

    const manifestEntry: string = manifest?.integration?.remoteEntry ?? ''
    const columnEntry: string = app.remote_url ?? ''

    if (manifestEntry !== CORRECT_ENTRY || columnEntry !== CORRECT_ENTRY || app.scope !== SCOPE) {
      const update: Record<string, unknown> = {
        integration_type: 'module-federation',
        remote_url: CORRECT_ENTRY,
        url: CORRECT_ENTRY,
        scope: SCOPE,
        module: MODULE,
        updated_at: new Date(),
      }

      if (manifest) {
        if (!manifest.integration) manifest.integration = {}
        manifest.integration.type = 'module-federation'
        manifest.integration.remoteEntry = CORRECT_ENTRY
        manifest.integration.scope = SCOPE
        manifest.integration.module = MODULE
        if (!manifest.routing) manifest.routing = {}
        manifest.routing.path = ROUTING_PATH
        update.manifest = JSON.stringify(manifest)
      }

      await knex('apps').where('id', app.id).update(update)
      console.log(
        `[015] ${SLUG}: manifest '${manifestEntry || '<empty>'}' / column '${columnEntry || '<empty>'}' → ${CORRECT_ENTRY}`
      )
    } else {
      console.log(`[015] ${SLUG}: already correct, no-op`)
    }
  } else {
    console.log(`[015] ${SLUG}: app row not found, nothing to repair`)
  }

  // Handle stranded duplicate `fuzemarket` row if it exists alongside active `market`
  const orphan = await knex('apps').where('slug', 'fuzemarket').first()
  if (orphan && app && app.status === 'activated' && orphan.status !== 'suspended') {
    await knex('apps').where('id', orphan.id).update({
      status: 'suspended',
      updated_at: new Date(),
    })
    console.log(`[015] suspended stranded duplicate 'fuzemarket' row in favor of '${SLUG}'`)
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Irreversible
}
