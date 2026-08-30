import { Knex } from 'knex'

/**
 * Convert the `fuzesocial` builtin from an `iframe` embed of
 * `https://social.prod.fuzefront.com` to a same-origin module-federation
 * remote at `/apps/fuzesocial/remoteEntry.js`, matching the mount landed on
 * the FuzeSocial side (izzywdev/FuzeSocial
 * `packages/fuzesocial-ui/vite.config.ts` `base: '/apps/fuzesocial/'` +
 * `assetsDir: ''`, `nginx.conf`, and
 * `deploy/helm/fuzesocial/templates/remote-ingress.yaml`) and the frozen seed
 * manifest (`services/app-registry-service/seed/fuzesocial.manifest.json`).
 *
 * Companion to 008 (`fuzequality`/`clock`) and 009 (`fuzeagent`). Unlike those,
 * this row is not merely re-pointed — its integration TYPE changes,
 * `iframe` → `module-federation`, so `scope`/`module` are populated for the
 * first time and the `manifest.integration` object is rewritten in full (the
 * old `url` key is dropped; the host reads `remoteEntry`/`scope`/`module`).
 *
 * WHY a migration is required and editing builtins.ts is not enough:
 * `upsertBuiltin` is `if (existing) return` — deliberately, so a seed rerun
 * never clobbers operator state. `fuzesocial` is already registered in prod
 * (seeded with the old iframe URL), so the builtins.ts change alone is inert
 * on an existing database.
 *
 * WHY the integration changes at all: `social.prod.fuzefront.com` is loaded BY
 * THE BROWSER over the public edge, and `*.prod.fuzefront.com` sits behind the
 * Cloudflare Access admin wall — which answers a request with an HTML login
 * page rather than the app. As an iframe that shows a login wall; as the
 * federation target it would fail with "Failed to fetch dynamically imported
 * module". Served under the host's own origin instead, the request is proxied
 * by FuzeSocial's `/apps/fuzesocial` Ingress straight to its in-cluster
 * Service.
 *
 * No `assets/` segment: FuzeSocial's Vite build sets `assetsDir: ''` (flat
 * output), so its same-origin entry is `/apps/fuzesocial/remoteEntry.js`
 * (root of the base), the same shape as `fuzeagent` in 009 — a per-app build
 * decision, not a convention we can infer.
 *
 * Guarded: the row is only touched when it is still the known iframe embed
 * (integration_type = 'iframe' AND url on the social.prod.fuzefront.com host).
 * A row already federated, or pointing somewhere unrecognised, is left alone —
 * an operator may have re-pointed it on purpose.
 *
 * `manifest` (jsonb) is the authoritative copy the frontend reads
 * (service.ts rowToApp returns it verbatim); `integration_type` / `remote_url`
 * / `scope` / `module` / `url` are the legacy columns. All are updated together
 * or the row would disagree with itself.
 */

const SLUG = 'fuzesocial'
const REMOTE_ENTRY = '/apps/fuzesocial/remoteEntry.js'
const SCOPE = 'fuzesocial'
const MODULE = './App'

// The iframe host we are willing to convert away from. A row already federated,
// or embedding some other URL, is not ours to move.
const REWRITABLE_IFRAME_HOST = /^https?:\/\/social\.(prod\.)?fuzefront\.com\/?/i

export async function up(knex: Knex): Promise<void> {
  const app = await knex('apps').where('slug', SLUG).first()
  if (!app) return

  if (app.integration_type === 'module-federation' && app.remote_url === REMOTE_ENTRY) {
    return // already converted
  }

  const currentUrl: string = app.url ?? app.remote_url ?? ''
  const looksLikeOurIframe =
    app.integration_type === 'iframe' && REWRITABLE_IFRAME_HOST.test(currentUrl)
  if (!looksLikeOurIframe) {
    console.log(
      `[012] ${SLUG}: leaving unrecognised integration untouched ` +
        `(type=${app.integration_type ?? '<none>'}, url=${currentUrl || '<empty>'})`
    )
    return
  }

  // Keep the jsonb manifest — the copy the host actually loads from — in step
  // with the columns: rewrite integration wholesale (drop the iframe `url`).
  let manifest: Record<string, any> | null = null
  try {
    manifest =
      typeof app.manifest === 'string' ? JSON.parse(app.manifest) : app.manifest
  } catch {
    manifest = null
  }

  const update: Record<string, unknown> = {
    integration_type: 'module-federation',
    // upsertBuiltin sets `url` = integration.url || integration.remoteEntry, so
    // for a federated row `url` mirrors the remote entry.
    url: REMOTE_ENTRY,
    remote_url: REMOTE_ENTRY,
    scope: SCOPE,
    module: MODULE,
    updated_at: new Date(),
  }

  if (manifest) {
    manifest.integration = {
      type: 'module-federation',
      remoteEntry: REMOTE_ENTRY,
      scope: SCOPE,
      module: MODULE,
    }
    update.manifest = JSON.stringify(manifest)
  } else {
    console.log(
      `[012] ${SLUG}: columns updated but manifest jsonb was unreadable — the ` +
        `host reads the manifest, so this row still needs a re-register`
    )
  }

  await knex('apps').where('id', app.id).update(update)
  console.log(`[012] ${SLUG}: iframe ${currentUrl} → module-federation ${REMOTE_ENTRY}`)
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible: the previous value was fuzesocial's public
  // iframe URL (social.prod.fuzefront.com), which sits behind the Cloudflare
  // Access wall and renders a login page instead of the app. Rolling back would
  // restore an embed that is known not to load in the portal.
}
