import { Knex } from 'knex'

/**
 * Re-point in-cluster family remotes from their own public hostnames to the
 * host shell's origin: `/apps/<slug>/assets/remoteEntry.js`.
 *
 * WHY a migration is required and editing builtins.ts is not enough:
 * `upsertBuiltin` is `if (existing) return` — deliberately, so a seed rerun
 * never clobbers operator state. Every one of these apps is already registered
 * in prod, so the seed change alone would be inert.
 *
 * WHY the URLs change at all: a remote on `<app>.prod.fuzefront.com` is fetched
 * BY THE BROWSER over the public edge, and `*.prod.fuzefront.com` sits behind
 * the Cloudflare Access admin wall — which answers an asset request with an
 * HTML login page, so the federation runtime fails with "Failed to fetch
 * dynamically imported module". Served under the host's own origin instead, the
 * request is proxied by the app's `/apps/<slug>` Ingress straight to its
 * in-cluster Service.
 *
 * Only rows whose remote_url is one of the KNOWN public hostnames below are
 * touched, keyed by slug. A row already relative, or pointing somewhere we do
 * not recognise, is left alone — an operator may have re-pointed it on purpose,
 * and a blind rewrite of every absolute URL would break genuinely external
 * remotes that are hosted outside this cluster by design.
 *
 * `manifest` (jsonb) is the authoritative copy the frontend reads
 * (service.ts rowToApp returns it verbatim); `remote_url` / `url` are the
 * legacy columns. All three are updated together or the row would disagree
 * with itself.
 */

// slug -> the same-origin entry it should be served from. Kept explicit rather
// than derived: the path segment after the slug is the app's Vite `base` +
// output dir, which is a per-app build decision, not a convention we can infer.
const SAME_ORIGIN_REMOTES: Record<string, string> = {
  fuzequality: '/apps/fuzequality/assets/remoteEntry.js',
  clock: '/apps/clock/assets/remoteEntry.js',
}

// Hostnames we are willing to rewrite away from. A remote_url must match one of
// these (or already be relative) for the row to be considered ours to move.
const REWRITABLE_HOST = /^https?:\/\/(quality|fuzequality|clock|app)\.(prod\.)?fuzefront\.com\//i

export async function up(knex: Knex): Promise<void> {
  for (const [slug, entry] of Object.entries(SAME_ORIGIN_REMOTES)) {
    const app = await knex('apps').where('slug', slug).first()
    if (!app) continue

    const current: string = app.remote_url ?? ''
    if (current === entry) continue
    if (!REWRITABLE_HOST.test(current)) {
      console.log(
        `[008] ${slug}: leaving unrecognised remote_url untouched (${current || '<empty>'})`
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
        `[008] ${slug}: columns updated but manifest jsonb was unreadable — the host reads the manifest, so this row still needs a re-register`
      )
    }

    await knex('apps').where('id', app.id).update(update)
    console.log(`[008] ${slug}: ${current} → ${entry}`)
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible: the previous values were per-app public
  // hostnames that differed per row and are not recoverable from the new value.
  // Rolling back would also restore URLs that are known not to load.
}
