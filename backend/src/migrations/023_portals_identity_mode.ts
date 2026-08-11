import { Knex } from 'knex'

/**
 * FF-EPIC-XX (Portals Directory, backend slice S1) — adds `portals.identity_mode`.
 *
 * A portal is either:
 *   - `soft`  — shares the root FuzeFront Authentik directory (the default;
 *     every ordinary tenant portal provisioned through
 *     `services/portalProvisioning.ts` today).
 *   - `hard`  — owns a dedicated Authentik instance (its own directory, DB,
 *     ingress host, and blueprint set) rather than a brand inside the shared
 *     one. MendysRobotics is the only such tenant today
 *     (`deploy/helm/fuzefront/templates/authentik-mendys.yaml`,
 *     `deploy/helm/fuzefront/authentik/blueprints-mendys/`).
 *
 * This was previously implicit (deploy-time Helm config, never a `portals`
 * row attribute) — this migration makes it a first-class, queryable column so
 * the master-admin portals directory (FF-EPIC platform, S1) can render it.
 *
 * Idempotent: `CREATE TYPE` is guarded by the same `DO $$ ... EXCEPTION WHEN
 * duplicate_object` pattern as migration 012, and the column add is guarded
 * by `hasColumn`, mirroring migration 019/020's column-add convention. Safe
 * to re-run.
 *
 * BACKFILL: existing rows already default to `'soft'` via the column
 * default. Additionally, this attempts to mark any existing MendysRobotics
 * portal row `'hard'`, matched by slug. As of this migration, MendysRobotics
 * is NOT modeled as a `portals`/`portal_domains` row anywhere in this
 * backend at all — `git grep -i mendys` across `backend/src` and `deploy`
 * shows it is a fully separate deployment (its own Authentik instance,
 * ingress host `live./marketplace.mendysrobotics.com`, own OIDC providers)
 * with no corresponding row in this schema. This UPDATE therefore matches
 * ZERO rows today and is a documented, safe no-op — it exists so that IF a
 * `portals` row for Mendys is ever created under one of these candidate
 * slugs (by this or a future migration/seed), it is retroactively (and on
 * every future re-run of this migration, which is idempotent by construction
 * — an UPDATE ... WHERE that matches nothing is a no-op) classified `'hard'`
 * rather than silently staying `'soft'`.
 */

const MENDYS_CANDIDATE_SLUGS = ['mendys', 'mendysrobotics', 'mendys-robotics']

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE portal_identity_mode_enum AS ENUM ('soft', 'hard');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)

  const hasColumn = await knex.schema.hasColumn('portals', 'identity_mode')
  if (!hasColumn) {
    await knex.schema.alterTable('portals', table => {
      table
        .enum('identity_mode', null, {
          useNative: true,
          existingType: true,
          enumName: 'portal_identity_mode_enum',
        })
        .notNullable()
        .defaultTo('soft')
      table.index(['identity_mode'])
    })
  }

  // Backfill 'hard' for a Mendys/MendysRobotics portal row IF one exists.
  // See module doc above — expected to affect 0 rows today.
  const backfilled = await knex('portals')
    .whereIn('slug', MENDYS_CANDIDATE_SLUGS)
    .update({ identity_mode: 'hard', updated_at: knex.fn.now() })
  console.log(
    `[023] portals.identity_mode backfill: marked ${backfilled} row(s) 'hard' ` +
      `for Mendys candidate slugs (0 expected until a Mendys portal row exists)`
  )
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('portals', 'identity_mode')
  if (hasColumn) {
    await knex.schema.alterTable('portals', table => {
      table.dropColumn('identity_mode')
    })
  }
  await knex.raw('DROP TYPE IF EXISTS portal_identity_mode_enum')
}
