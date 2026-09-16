import { Knex } from 'knex'

/**
 * Suspends the STRANDED DUPLICATE registry rows for FuzeSales and FuzeService.
 *
 * WHAT IS WRONG. The live registry holds four rows for two products, and each
 * product therefore renders TWICE in the portal menu (census run 34084771931,
 * 2026-09-07):
 *
 *   sales        Sales        activated  PASS   remoteEntry + 2 chunks, all JS
 *   fuzesales    FuzeSales    activated  FAIL   fuzesales.prod.fuzefront.com/assets/remoteEntry.js -> 404
 *   service      Service      activated  FAIL   app.fuzefront.com/apps/service/remoteEntry.js -> 404
 *   fuzeservice  FuzeService  activated  PASS   remoteEntry + 2 chunks, all JS
 *
 * WHICH ONE IS REAL is not a judgement call — each repo's own
 * `registration/manifest.json` is authoritative, because production stores
 * `slug: row.slug` verbatim (app-registry/service.ts) and `register.sh` re-PUTs
 * that manifest on every pod start:
 *
 *   izzywdev/FuzeSales/registration/manifest.json    -> "slug": "sales"
 *   izzywdev/FuzeService/registration/manifest.json  -> "slug": "service"
 *
 * So `sales` and `service` are the rows those products keep refreshing, and
 * `fuzesales` / `fuzeservice` are orphans from an earlier registration under a
 * different slug — exactly the failure CLAUDE.md describes: "a redeploy under a
 * changed slug registers a second app and strands the first". Nothing re-PUTs
 * the orphans, so they will sit at whatever URL they last held forever.
 *
 * NOT A SLUG MIGRATION. No slug is edited here, in either direction. `PUT
 * /apps/{slug}` has no rename and CLAUDE.md forbids it; this migration only
 * changes a `status`, which is ordinary mutable state.
 *
 * WHY SUSPEND RATHER THAN DELETE — same reasoning as 011: `app_installations`
 * CASCADE-deletes on the app row, suspension is reversible with one setStatus,
 * and `suspended` is the status `list()` already hides and the host UI already
 * filters out (frontend/src/platform/appRegistry.tsx asks for 'activated').
 *
 * SCOPE GUARDS — the point is ONE WORKING REGISTRATION PER PRODUCT, never zero:
 *
 *   - The canonical row must EXIST and be `activated`. If it is missing or
 *     itself suspended, the orphan is the only tile the product has and this
 *     migration leaves it alone and says so.
 *   - A `builtin` orphan is never touched. Built-ins are re-seeded on every
 *     boot by ensureBuiltins(), so suspending one would be undone or would
 *     fight the seed; neither of these two slugs is in BUILTIN_MANIFESTS today,
 *     and if that changes this migration should not be the thing that discovers
 *     it silently.
 *   - Already-suspended rows are skipped, so re-running is a no-op.
 *
 * WHAT THIS DOES NOT CLAIM. Suspending `fuzeservice` removes the only Service
 * tile that currently LOADS: `service` points at
 * app.fuzefront.com/apps/service/remoteEntry.js, which 404s until
 * izzywdev/FuzeService#84 lands (its nginx ConfigMap carries the right
 * /apps/service/ alias, but the pod never restarted to pick it up). The
 * activated-canonical guard cannot detect that — it checks that a row exists,
 * not that its bundle loads. Land FuzeService#84 first; there is deliberately
 * no code here pretending to verify a remote over the network from a migration.
 */

type Duplicate = {
  /** The stranded row to suspend. */
  orphan: string
  /** The slug the product actually registers today. */
  canonical: string
  /** Where the canonical slug is declared, for the log line. */
  source: string
}

const DUPLICATES: Duplicate[] = [
  {
    orphan: 'fuzesales',
    canonical: 'sales',
    source: 'izzywdev/FuzeSales registration/manifest.json',
  },
  {
    orphan: 'fuzeservice',
    canonical: 'service',
    source: 'izzywdev/FuzeService registration/manifest.json',
  },
]

const TAG = '[013]'

export async function up(knex: Knex): Promise<void> {
  for (const { orphan, canonical, source } of DUPLICATES) {
    const orphanRow = await knex('apps').where('slug', orphan).first()
    if (!orphanRow) {
      console.log(`${TAG} ${orphan}: no row present — nothing to do`)
      continue
    }

    if (orphanRow.status === 'suspended') {
      console.log(`${TAG} ${orphan}: already suspended — nothing to do`)
      continue
    }

    if (orphanRow.builtin) {
      console.log(
        `${TAG} ${orphan}: row is builtin:true — left untouched. ensureBuiltins() re-seeds ` +
          `built-ins on every boot, so suspending one here would be undone or would fight the ` +
          `seed. If this slug is genuinely a built-in now, remove it from BUILTIN_MANIFESTS first.`
      )
      continue
    }

    const canonicalRow = await knex('apps').where('slug', canonical).first()
    if (!canonicalRow) {
      console.log(
        `${TAG} ${orphan}: canonical row '${canonical}' (${source}) is ABSENT — leaving the ` +
          `orphan activated. Suspending it would leave this product with no tile at all.`
      )
      continue
    }

    if (canonicalRow.status !== 'activated') {
      console.log(
        `${TAG} ${orphan}: canonical row '${canonical}' is '${canonicalRow.status}', not ` +
          `'activated' — leaving the orphan activated so the product keeps exactly one tile.`
      )
      continue
    }

    await knex('apps').where('id', orphanRow.id).update({
      status: 'suspended',
      updated_at: new Date(),
    })

    console.log(
      `${TAG} ${orphan}: status ${orphanRow.status} → suspended (stranded duplicate; ` +
        `'${canonical}' is the slug the product registers, per ${source})`
    )
  }
}

export async function down(knex: Knex): Promise<void> {
  // Reversible, like 011 and unlike 010: nothing here is known-broken data, it
  // is a visibility decision. Rolling back restores both tiles — and with them
  // the duplicate menu entries this migration exists to remove.
  for (const { orphan } of DUPLICATES) {
    const row = await knex('apps').where('slug', orphan).first()
    if (!row) continue
    if (row.status !== 'suspended') continue

    await knex('apps').where('id', row.id).update({
      status: 'activated',
      updated_at: new Date(),
    })
    console.log(`${TAG} ${orphan}: status suspended → activated (rollback)`)
  }
}
