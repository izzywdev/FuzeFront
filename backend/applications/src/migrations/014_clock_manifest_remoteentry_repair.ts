import { Knex } from 'knex'

/**
 * Repairs the built-in `clock` app's federated entry in the field the HOST
 * ACTUALLY READS: `manifest.integration.remoteEntry`.
 *
 * MEASURED, 2026-09-07, from one census run and one probe run taken minutes
 * apart against production:
 *
 *   probe  34152480534: /apps/clock/remoteEntry.js         -> 200, valid JS, all chunks load
 *   census 34152488777: /apps/clock/assets/remoteEntry.js  -> HTTP 404
 *
 * The bundle is deployed and correct. The registry is pointing one directory
 * too deep, so the host resolves a URL that nginx answers from its SPA
 * fallback and the panel stays blank while every healthcheck is green.
 *
 * WHY 010 DID NOT ALREADY FIX THIS, AND WHY IT IS NOT EDITED HERE
 *
 * 010_clock_remoteentry_assets_segment_fix.ts exists for exactly this defect
 * and is correct about the values. Its GUARD is the problem:
 *
 *     const current: string = app.remote_url ?? ''
 *     if (current !== WRONG_ENTRY) { ...log 'leaving untouched'...; return }
 *
 * It gates on the `remote_url` COLUMN, then (and only then) rewrites the
 * columns AND the manifest. But `service.ts`'s rowToApp returns the `manifest`
 * jsonb verbatim, and `frontend/src/utils/loadFederatedApp.ts` resolves
 * `integration.remoteEntry` out of that manifest — the column is not what
 * loads the remote. So whenever the two disagree, 010 reads a `remote_url`
 * that is not its literal known-wrong string, concludes the row is somebody's
 * deliberate customisation, logs that it is leaving it alone, and returns.
 * The manifest keeps the broken path indefinitely, and the log line makes it
 * look intentional.
 *
 * 010 has already run; editing an applied migration changes nothing on any
 * database that has it recorded. Hence a new one.
 *
 * WHAT THIS ONE DOES DIFFERENTLY: it decides on the field the host reads, and
 * it repairs every copy it finds — manifest, `remote_url`, `url` — so they
 * cannot drift apart again the way they did here. It is still narrowly
 * guarded: it acts only when the manifest entry is one of the two known-wrong
 * shapes 008 could have produced (the relative `/assets/` path, or an absolute
 * URL ending in that same path). Anything else is left alone and logged, for
 * 010's original reason — an operator may have re-pointed the row on purpose.
 *
 * Idempotent: a row already carrying CORRECT_ENTRY is skipped, so re-running
 * is a no-op. Safe on a database where 010 already did the job.
 */

const SLUG = 'clock'
const CORRECT_ENTRY = '/apps/clock/remoteEntry.js'
const WRONG_SUFFIX = '/apps/clock/assets/remoteEntry.js'

/** True for the relative wrong path and for any absolute URL ending in it. */
function isKnownWrongEntry(value: string): boolean {
  if (!value) return false
  if (value === WRONG_SUFFIX) return true
  try {
    return new URL(value).pathname === WRONG_SUFFIX
  } catch {
    return false
  }
}

export async function up(knex: Knex): Promise<void> {
  const app = await knex('apps').where('slug', SLUG).first()
  if (!app) {
    console.log(`[014] ${SLUG}: not registered, nothing to repair`)
    return
  }

  let manifest: Record<string, any> | null = null
  try {
    manifest = typeof app.manifest === 'string' ? JSON.parse(app.manifest) : app.manifest
  } catch {
    manifest = null
  }

  const manifestEntry: string = manifest?.integration?.remoteEntry ?? ''
  const columnEntry: string = app.remote_url ?? ''

  if (manifestEntry === CORRECT_ENTRY && columnEntry === CORRECT_ENTRY) {
    console.log(`[014] ${SLUG}: already correct, no-op`)
    return
  }

  // The manifest is the authority: it is what the host resolves. A row whose
  // manifest is neither the known-wrong value nor the correct one is left
  // alone -- same stance as 010, for the same reason.
  if (!isKnownWrongEntry(manifestEntry) && manifestEntry !== CORRECT_ENTRY) {
    console.log(
      `[014] ${SLUG}: manifest.integration.remoteEntry is not a known-wrong value, leaving untouched (${manifestEntry || '<empty>'})`
    )
    return
  }

  const update: Record<string, unknown> = {
    remote_url: CORRECT_ENTRY,
    url: CORRECT_ENTRY,
    updated_at: new Date(),
  }

  // Reaching here means manifestEntry was a known-wrong value or already
  // CORRECT_ENTRY, both of which require a readable manifest.integration — so
  // there is no unreadable-manifest branch here on purpose. A row whose
  // manifest jsonb cannot be parsed yields an empty entry and is returned above
  // as "not a known-wrong value", logged, and left for a re-register. Writing
  // the columns for such a row would report a repair the host cannot see.
  manifest!.integration.remoteEntry = CORRECT_ENTRY
  update.manifest = JSON.stringify(manifest)

  await knex('apps').where('id', app.id).update(update)
  console.log(
    `[014] ${SLUG}: manifest '${manifestEntry || '<empty>'}' / column '${columnEntry || '<empty>'}' → ${CORRECT_ENTRY}`
  )
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible, same as 010: the previous value is known-broken
  // (nginx serves no /apps/clock/assets/remoteEntry.js), so rolling back would
  // restore a URL measured not to load.
}
