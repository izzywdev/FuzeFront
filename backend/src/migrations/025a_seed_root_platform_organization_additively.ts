import { Knex } from 'knex'
import { ROOT_ORG_ID } from './015_seed_root_platform_organization'

/**
 * Seed the platform root organization ADDITIVELY, and preserve the visibility
 * of the apps that are about to be backfilled onto it.
 *
 * ── THE FILENAME IS LOAD-BEARING: THIS MUST SORT BEFORE 026 ─────────────────
 *
 * knex runs migrations in lexical filename order, so `025a_` is not cosmetic
 * and renumbering this file to `028_` (where it originally shipped) makes it
 * DEAD CODE. That is not hypothetical — it is what happened:
 *
 *   migration file "026_apps_organization_id_not_null.js" failed
 *   migration failed with error: organizations.00000000-...-000000000010 (the
 *   platform root org) does not exist yet, and 17 org-less app(s) need
 *   backfilling to it
 *     at Object.up (/app/backend/dist/migrations/026_apps_organization_id_not_null.js:59:19)
 *
 * 026 REQUIRES the row this migration creates, and 026 sorts first. The chain
 * therefore died at 026 on every boot and never reached 028. Because knex does
 * not record a migration that throws, there was no self-healing path: the
 * backend crash-looped (694 restarts, measured 2026-09-20), so the only Ready
 * pod stayed on a pre-seed image, so the seed never ran, so 026 kept throwing.
 *
 * Shipping the fix AFTER the thing it fixes is the whole bug. It is also
 * exactly the failure this migration was written to end, one migration tree
 * over: applications-service's own 011_apps_organization_id_not_null throws
 * the same way for the same missing row. Both unblock the moment this one
 * commits, and neither can unblock while this sorts last.
 *
 * If you add another migration that depends on ROOT_ORG_ID existing, it goes
 * AFTER this file. If you add one this depends on, it goes before. Do not
 * renumber this to tidy the sequence.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Migration 015 seeds `organizations.ROOT_ORG_ID`, but it has legitimate
 * branches that leave the row absent, and production is in one of them. The
 * 2026-07-29 rebuild left a `type='platform'` organization under a DIFFERENT
 * id — `92f2020b-2bdb-41f0-98ff-1ef759b41741`, holding slug `fuzefront`
 * (recorded in 022's header, security/015's header, and the #680 test
 * comments) — so 015 takes its adopt branch and returns without creating
 * ROOT_ORG_ID. It refuses to REPOINT that org unattended, correctly: rows
 * already reference its id, and Permit tenants keyed to it do not cascade
 * with a SQL update. #750 asked for a deliberate repoint-or-reparent
 * decision; this migration is the REPARENT half, chosen by the owner
 * 2026-09-14.
 *
 * The cost of that decision never being made is not theoretical. The
 * applications-service migration 011 throws when ROOT_ORG_ID is absent AND
 * there are org-less `apps` rows to backfill (production: 17). knex never
 * records a migration that throws, so it re-throws on EVERY boot — a
 * permanent crashloop, measured at 1104 and 1171 restarts on 2026-09-14,
 * with the only Ready pod still serving image `9431cdb9dc1f`, whose
 * migration tree stops at 008. Migrations 009–014 are merged, correct, and
 * have never executed. That is why the portal still shows FuzeSocial as an
 * iframe, FuzeSales/FuzeService twice, and Clock on the wrong remoteEntry
 * path.
 *
 * ── ADDITIVE, NOT A REPOINT ─────────────────────────────────────────────────
 *
 * This INSERTs a new row and touches no existing organization. Nothing is
 * repointed, no existing reference is orphaned, and no Permit-side migration
 * is required. The ~30 call sites that reference the literal ROOT_ORG_ID
 * start resolving, which is what they always expected.
 *
 * The adopted org keeps slug `fuzefront`, so this one cannot have it —
 * 015's own slug-collision branch is the trap here, where an untargeted
 * `ON CONFLICT DO NOTHING` swallows a slug conflict and the caller infers
 * "already present" from "I inserted nothing" (#750). So: a free slug is
 * chosen explicitly BEFORE the insert, the conflict target is the primary
 * key only, and the postcondition is re-read rather than inferred.
 *
 * ── THE VISIBILITY HALF, WHICH IS NOT OPTIONAL ──────────────────────────────
 *
 * Creating the root org lets applications-service 011 finally run. 011
 * backfills every org-less `apps` row to ROOT_ORG_ID and sets NOT NULL. That
 * is correct — but on its own it would HIDE APPS.
 *
 * The image running in production right now (`9431cdb9dc1f`) filters with
 * `.whereIn('visibility', ['public','marketplace']).orWhereNull('organization_id')`
 * — so an org-less row is visible to EVERY caller regardless of its declared
 * `visibility`. That third branch was removed by the owner ruling of
 * 2026-08-25 as a latent BOLA hole. Once 011 backfills, an org-less row that
 * declares `private` or `organization` stops matching the public branch and
 * starts requiring root-org membership — so it vanishes for every user who
 * is not a member of the org created here.
 *
 * That is the exact opposite of the goal (products MISSING from the portal),
 * so this migration pins the current effective visibility of those rows
 * before the backfill can reach them: any org-less row not already
 * public/marketplace is set to `public`.
 *
 * This grants NO new access. Those rows are visible to every caller TODAY,
 * via the `orWhereNull` branch above; writing `public` records the access
 * that already exists instead of leaving it implicit in a branch that is
 * being deleted. Each product's own manifest governs from its next
 * re-registration — `register.sh` re-PUTs `visibility` on every pod start —
 * so a product that genuinely wants to be private gets there by declaring
 * it, which is the intended mechanism.
 *
 * BOTH the `visibility` column and `manifest->>'visibility'` are written.
 * `list()` filters on the COLUMN; `canRead()` reads the MANIFEST. Updating
 * one and not the other is how a row ends up filtered in but then denied,
 * or listed but not loadable.
 *
 * ── WHAT THIS DELIBERATELY LEAVES DIVERGENT ─────────────────────────────────
 *
 * After this runs there are TWO `type='platform'` organizations, and the two
 * ways the codebase resolves "the root org" stop agreeing:
 *
 *   - the LITERAL `ROOT_ORG_ID` (~30 call sites: portals.ts, security.ts's
 *     org-tree walk, employeeRole.ts's ReBAC check, scopeToPortal.ts, 026's
 *     backfill) resolves to the row created here;
 *   - "oldest `type='platform'`" (ensureRootPortal(), 015's adopt branch,
 *     022, security/015) still resolves to the adopted `92f2020b-…`, which
 *     was created 2026-07-29 and stays older.
 *
 * This is not a regression: today the literal resolves to NOTHING, so those
 * call sites are already broken, and they are strictly better off. The
 * "oldest platform" paths are untouched. But the divergence is real and it is
 * the residue of choosing REPARENT over REPOINT — converging them means
 * repointing, which needs the Permit-side migration this migration exists to
 * avoid. Do not "tidy" this by deleting either row.
 *
 * ── ATOMICITY ───────────────────────────────────────────────────────────────
 *
 * The seed and the visibility pin MUST commit together. applications-service
 * 011 is crashlooping on a ~10s restart cycle, so it will observe this
 * database within seconds of the commit. knex runs each migration in a
 * transaction, so 011 can never see "root org present, visibility not yet
 * pinned" — the window in which it would backfill rows that then disappear.
 * Do not split this into two migrations.
 */

const PLATFORM_REGISTRAR_ID = '00000000-0000-0000-0000-000000000001'

// Preferred first; production is expected to fall through to the second
// because the adopted platform org holds `fuzefront`. Ordered and finite so
// the chosen slug is deterministic and reviewable rather than generated.
const CANDIDATE_SLUGS = ['fuzefront', 'fuzefront-root', 'fuzefront-platform-root']

export async function up(knex: Knex): Promise<void> {
  // ── Part A: the root organization ────────────────────────────────────────
  let root = await knex('organizations').where({ id: ROOT_ORG_ID }).first()

  if (root) {
    // eslint-disable-next-line no-console
    console.log(`[025a] root platform organization ${ROOT_ORG_ID} already present — not re-seeding`)
  } else {
    const owner =
      (await knex('users').where({ id: PLATFORM_REGISTRAR_ID }).first()) ??
      (await knex('users').orderBy('created_at', 'asc').first())

    if (!owner) {
      // Same convention as 015: a database with no users yet is a fresh
      // install, and ensureRootPortal() handles it on a later boot. Not an
      // error, and specifically not a throw — a throw here is the crashloop
      // this migration exists to end.
      // eslint-disable-next-line no-console
      console.log('[025a] no users yet — root organization deferred to 015/ensureRootPortal()')
      return
    }

    let slug: string | null = null
    for (const candidate of CANDIDATE_SLUGS) {
      const holder = await knex('organizations').where({ slug: candidate }).first()
      if (!holder) {
        slug = candidate
        break
      }
      // eslint-disable-next-line no-console
      console.log(
        `[025a] slug '${candidate}' is held by organization ${holder.id} (type=${holder.type ?? '<none>'}) — trying the next candidate`
      )
    }

    if (!slug) {
      // eslint-disable-next-line no-console
      console.error(
        `[025a] every candidate slug is taken (${CANDIDATE_SLUGS.join(', ')}) — NOT seeding ${ROOT_ORG_ID}. ` +
          'Free one of those slugs, or add a candidate, then re-run. Deliberately not generating a ' +
          'random slug: the root org is a durable identity and its slug should be reviewable in the diff.'
      )
      return
    }

    // Conflict target is the PRIMARY KEY ONLY — never untargeted. An
    // untargeted DO NOTHING also swallows a slug-unique conflict, which is
    // precisely how #750 concluded "already present" from "inserted nothing"
    // and then FK-violated. The slug is already known free above; pinning the
    // target means a slug collision RAISES here instead of being silent.
    await knex.raw(
      `INSERT INTO organizations
         (id, name, slug, parent_id, owner_id, type, settings, metadata, is_active, provisioning_state)
       VALUES (?, 'FuzeFront', ?, NULL, ?, 'platform', '{}'::jsonb, ?::jsonb, true, 'pending')
       ON CONFLICT (id) DO NOTHING`,
      [ROOT_ORG_ID, slug, owner.id, JSON.stringify({ root: true, seededBy: '025a', additive: true })]
    )

    // Assert the postcondition; never infer it from the insert's rowCount.
    root = await knex('organizations').where({ id: ROOT_ORG_ID }).first()
    if (!root) {
      // eslint-disable-next-line no-console
      console.error(
        `[025a] FAILED to seed root platform organization ${ROOT_ORG_ID} under slug '${slug}' — ` +
          'the row is still absent after the INSERT. Skipping the owner-membership insert, which ' +
          'would otherwise violate organization_memberships_organization_id_foreign.'
      )
      return
    }

    // eslint-disable-next-line no-console
    console.log(`[025a] created root platform organization ${ROOT_ORG_ID} with slug '${slug}'`)

    await knex.raw(
      `INSERT INTO organization_memberships
         (id, user_id, organization_id, role, status, joined_at, permissions, metadata)
       VALUES (gen_random_uuid(), ?, ?, 'owner', 'active', NOW(), '{}'::jsonb, '{}'::jsonb)
       ON CONFLICT DO NOTHING`,
      [owner.id, ROOT_ORG_ID]
    )
  }

  // ── Part B: pin the visibility of the rows 011 is about to backfill ──────
  //
  // Runs whether or not Part A created the row: on a re-run, or on a database
  // where 015 already succeeded, the WHERE matches nothing and this is a
  // no-op. It must not be conditional on having just created the org.
  // TWO TREES, ONE TABLE. `apps` is migrated by BOTH this tree and the
  // applications-service's, and they do not agree on its columns. In the
  // SHARED production database `slug` and `manifest` exist, because the
  // applications tree created them (004_apps_slug_unique_constraint,
  // 003_add_app_manifest_and_lifecycle). In a database where only THIS tree
  // has run — every CI run of backend/tests — they do not exist at all.
  //
  // The first version of this migration selected `slug` unconditionally. CI
  // caught it: `column "slug" does not exist`, which aborts the surrounding
  // transaction and takes the whole migration chain down with it. That is the
  // very crashloop shape this migration exists to end, so every column beyond
  // the ones THIS tree guarantees is probed first — the same discipline
  // 006_update_apps_for_organizations already uses for its own additions.
  const hasSlug = await knex.schema.hasColumn('apps', 'slug')
  const hasManifest = await knex.schema.hasColumn('apps', 'manifest')

  // `id`, `organization_id` and `visibility` are guaranteed by this tree
  // (002_create_apps_table + 006_update_apps_for_organizations).
  const label = hasSlug ? 'slug' : 'id'
  const pending = await knex.raw(
    `SELECT ${label} AS label, visibility
       FROM apps
      WHERE organization_id IS NULL
        AND (visibility IS NULL OR visibility NOT IN ('public', 'marketplace'))`
  )
  const rows: Array<{ label: string; visibility: string | null }> = (pending as any)?.rows ?? []

  if (rows.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[025a] no org-less apps needed a visibility pin')
    return
  }

  // Logged BEFORE the update, and with the prior value, because the update is
  // not reversible from the resulting state — see down().
  // eslint-disable-next-line no-console
  console.log(
    `[025a] pinning ${rows.length} org-less app(s) to public, preserving the access they already ` +
      `have via the orWhereNull branch: ` +
      rows.map(r => `${r.label}(was ${r.visibility ?? 'null'})`).join(', ')
  )

  // The manifest is the copy the HOST reads (canRead() uses
  // manifest.visibility) while list() filters on the COLUMN, so both must move
  // together wherever both exist. Where the manifest column does not exist,
  // there is no second copy to drift from.
  const manifestSet = hasManifest
    ? `,
            manifest = CASE
              WHEN manifest IS NOT NULL
                THEN jsonb_set(manifest, '{visibility}', '"public"'::jsonb, true)
              ELSE manifest
            END`
    : ''

  await knex.raw(
    `UPDATE apps
        SET visibility = 'public'${manifestSet},
            updated_at = NOW()
      WHERE organization_id IS NULL
        AND (visibility IS NULL OR visibility NOT IN ('public', 'marketplace'))`
  )
}

export async function down(_knex: Knex): Promise<void> {
  // Intentionally irreversible, for two independent reasons.
  //
  // The organization: deleting ROOT_ORG_ID would orphan every row that
  // referenced it in the meantime — the same reasoning as 015's down().
  //
  // The visibility pin: the prior per-row values are not recoverable from the
  // post-state, since `public` is indistinguishable from a row that was
  // already public. They are written to the migration log above instead. A
  // blanket revert to `private` would be worse than doing nothing: it would
  // hide apps that were public before this ran.
}
