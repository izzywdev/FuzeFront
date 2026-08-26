import { Knex } from 'knex'

/**
 * Extends 008 (`008_same_origin_federated_remotes.ts`) to add `fuzeagent`,
 * matching the same-origin mount landed on the FuzeAgent side
 * (izzywdev/FuzeAgent#184, `deploy/helm/fuzeagent` `federatedMount` +
 * `services/ui-react/vite.config.ts` `base: '/apps/fuzeagent/'` +
 * `assetsDir: ''`). 008 shipped only `fuzequality` and `clock` — `fuzeagent`
 * was left out of that allow-list and this migration is the companion fix.
 *
 * WHY a migration is required and editing builtins.ts is not enough:
 * `upsertBuiltin` is `if (existing) return` — deliberately, so a seed rerun
 * never clobbers operator state. `fuzeagent` is already registered in prod
 * (its builtin row was seeded with the old cross-origin URL), so the
 * builtins.ts change alone would be inert on an existing database.
 *
 * WHY the URL changes at all: `fuzeagent.prod.fuzefront.com` is fetched BY
 * THE BROWSER over the public edge, and `*.prod.fuzefront.com` sits behind
 * the Cloudflare Access admin wall — which answers an asset request with an
 * HTML login page, so the federation runtime fails with "Failed to fetch
 * dynamically imported module". Served under the host's own origin instead,
 * the request is proxied by FuzeAgent's `/apps/fuzeagent` Ingress straight to
 * its in-cluster Service.
 *
 * Unlike `fuzequality`/`clock` (served at `/apps/<slug>/assets/remoteEntry.js`
 * via a nested `assets/` build output dir), FuzeAgent's Vite build sets
 * `assetsDir: ''` (flat output), so its same-origin entry has no `assets/`
 * segment: `/apps/fuzeagent/remoteEntry.js`. This is a per-app build decision,
 * not a convention we can infer — hence the explicit table, same as 008.
 *
 * Only rows whose remote_url is one of the KNOWN public hostnames below are
 * touched, keyed by slug. A row already relative, or pointing somewhere we do
 * not recognise, is left alone — an operator may have re-pointed it on
 * purpose, and a blind rewrite of every absolute URL would break genuinely
 * external remotes that are hosted outside this cluster by design.
 *
 * `manifest` (jsonb) is the authoritative copy the frontend reads
 * (service.ts rowToApp returns it verbatim); `remote_url` / `url` are the
 * legacy columns. All three are updated together or the row would disagree
 * with itself.
 *
 * NOTE (slug immutability): this migration never touches `slug`. FuzeAgent's
 * vendored `registration/manifest.json` was separately found to declare
 * `slug: "agent"` while the repo-root copy (and this migration / builtins.ts)
 * use `fuzeagent` — see the companion FuzeFront PR body for the write-up.
 * That is a live-registry question (does a stray `agent` row exist, does it
 * carry installs/grants) which this migration does not resolve and must not
 * attempt to "fix" by editing either slug.
 */

// slug -> the same-origin entry it should be served from. Kept explicit rather
// than derived: the path segment after the slug is the app's Vite `base` +
// output dir, which is a per-app build decision, not a convention we can infer.
const SAME_ORIGIN_REMOTES: Record<string, string> = {
  fuzeagent: '/apps/fuzeagent/remoteEntry.js',
}

// Hostnames we are willing to rewrite away from. A remote_url must match one of
// these (or already be relative) for the row to be considered ours to move.
const REWRITABLE_HOST = /^https?:\/\/(fuzeagent)\.(prod\.)?fuzefront\.com\//i

export async function up(knex: Knex): Promise<void> {
  for (const [slug, entry] of Object.entries(SAME_ORIGIN_REMOTES)) {
    const app = await knex('apps').where('slug', slug).first()
    if (!app) continue

    const current: string = app.remote_url ?? ''
    if (current === entry) continue
    if (!REWRITABLE_HOST.test(current)) {
      console.log(
        `[009] ${slug}: leaving unrecognised remote_url untouched (${current || '<empty>'})`
      )
      continue
    }

    // Keep the jsonb manifest — the copy the host actually loads from — in step
    // with the columns.
    let manifest: Record<string, any> | null = null
    try {
      manifest =
        typeof app.manifest === 'string' ? JSON.parse(app.manifest) : app.manifest
    } catch {
      manifest = null
    }

    const update: Record<string, unknown> = {
      remote_url: entry,
      url: entry,
      updated_at: new Date(),
    }

    if (manifest?.integration) {
      manifest.integration.remoteEntry = entry
      update.manifest = JSON.stringify(manifest)
    } else {
      console.log(
        `[009] ${slug}: columns updated but manifest jsonb was unreadable — the host reads the manifest, so this row still needs a re-register`
      )
    }

    await knex('apps').where('id', app.id).update(update)
    console.log(`[009] ${slug}: ${current} → ${entry}`)
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible: the previous value was fuzeagent's public
  // hostname, which is known not to load behind the Cloudflare Access wall.
  // Rolling back would restore a URL that is known to break the panel.
}
