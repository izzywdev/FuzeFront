import { Knex } from 'knex'

/**
 * Fixes an erroneous `/assets/` segment that 008_same_origin_federated_remotes.ts
 * baked into the built-in `clock` app's remoteEntry: `/apps/clock/assets/remoteEntry.js`.
 *
 * WHY THIS IS WRONG: `clock-app/vite.config.ts` sets `assetsDir: ''` (flat
 * build output) specifically so `remoteEntry.js` lands at the ROOT of the
 * `base` path, not under a nested `assets/` directory — its own comment says
 * so ("Output all chunks to dist/ directly (not dist/assets/) so
 * remoteEntry.js is served at /apps/clock/remoteEntry.js"). `clock-app/nginx.conf`
 * agrees: it declares `location = /remoteEntry.js` (exact match, no `assets/`
 * prefix), not `location = /assets/remoteEntry.js`. 008's SAME_ORIGIN_REMOTES
 * table conflated clock with fuzequality, which DOES nest under `assets/`
 * (fuzequality/apps/web/vite.config.ts has no `assetsDir` override, so Vite's
 * default `assets/` applies there) — but the two apps made different build
 * choices, and the migration used one path shape for both. Result: remoteEntry.js
 * 200s (nginx's `location /` SPA fallback serves index.html for the unmatched
 * `/assets/remoteEntry.js` request) but the host's module loader gets HTML
 * where it expected JS — the built-in reference app for federation was itself
 * broken.
 *
 * WHY A MIGRATION IS REQUIRED, NOT JUST A builtins.ts EDIT: `upsertBuiltin` is
 * `if (existing) return` — deliberately, so a seed rerun never clobbers
 * operator state. `clock` is already registered (seeded by 008 with the wrong
 * path), so the builtins.ts fix alone is inert on an existing database.
 *
 * Only rewrites a row whose remote_url is EXACTLY the known-wrong value 008
 * produced. A relative URL never matches 008/009's REWRITABLE_HOST regex
 * (anchored on `http(s)://`), so this migration checks the literal wrong
 * relative path instead — anything else (an operator customisation, or an
 * already-correct row) is left alone.
 */

const SLUG = 'clock'
const WRONG_ENTRY = '/apps/clock/assets/remoteEntry.js'
const CORRECT_ENTRY = '/apps/clock/remoteEntry.js'

export async function up(knex: Knex): Promise<void> {
  const app = await knex('apps').where('slug', SLUG).first()
  if (!app) return

  const current: string = app.remote_url ?? ''
  if (current !== WRONG_ENTRY) {
    console.log(
      `[010] ${SLUG}: remote_url is not the known-wrong value, leaving untouched (${current || '<empty>'})`
    )
    return
  }

  let manifest: Record<string, any> | null = null
  try {
    manifest = typeof app.manifest === 'string' ? JSON.parse(app.manifest) : app.manifest
  } catch {
    manifest = null
  }

  const update: Record<string, unknown> = {
    remote_url: CORRECT_ENTRY,
    url: CORRECT_ENTRY,
    updated_at: new Date(),
  }

  if (manifest?.integration) {
    manifest.integration.remoteEntry = CORRECT_ENTRY
    update.manifest = JSON.stringify(manifest)
  } else {
    console.log(
      `[010] ${SLUG}: columns updated but manifest jsonb was unreadable — the host reads the manifest, so this row still needs a re-register`
    )
  }

  await knex('apps').where('id', app.id).update(update)
  console.log(`[010] ${SLUG}: ${current} → ${CORRECT_ENTRY}`)
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible: the previous value is known-broken (nginx has
  // no /assets/remoteEntry.js to serve it from). Rolling back would restore a
  // URL that is known not to load.
}
