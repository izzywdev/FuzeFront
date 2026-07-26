import { Knex } from 'knex'

/**
 * Migrate Module-Federation remote_url values from localhost dev URLs to
 * same-origin relative paths (/apps/<slug>/remoteEntry.js).
 *
 * Same-origin relative paths are resolved by the browser against the page
 * origin and proxied by nginx to the in-cluster pod — no WAN hairpin, no
 * cross-origin fetch. The /apps/<slug>/ ingress location is defined in the
 * Helm chart's ingress.yaml for each registered federated app.
 *
 * Only rows whose remote_url starts with "http://localhost" are updated; any
 * row already using a relative path or a real external URL is left untouched.
 */
export async function up(knex: Knex): Promise<void> {
  const mfApps = await knex('apps')
    .where('integration_type', 'module-federation')
    .whereNotNull('remote_url')

  for (const app of mfApps) {
    const raw: string = app.remote_url ?? ''
    // Only rewrite localhost dev URLs — leave real external or already-relative URLs alone.
    if (!raw.startsWith('http://localhost') && !raw.startsWith('http://127.')) continue

    const slug = (app.name as string).toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const relativeUrl = `/apps/${slug}/remoteEntry.js`

    await knex('apps').where('id', app.id).update({
      remote_url: relativeUrl,
      updated_at: new Date(),
    })

    console.log(`[011] ${app.name}: ${raw} → ${relativeUrl}`)
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Cannot restore original localhost URLs meaningfully in prod.
  // This migration is intentionally irreversible.
}
