import type { Knex } from 'knex'

/**
 * App-registry governance fields — first-class, operator-managed columns on
 * `apps`. These are the DB-authoritative settings the platform owns (edited via
 * the API / admin UI), as opposed to the app-owned presentation/integration
 * fields a product re-pushes on every self-registration. See the app-governance
 * split: self-registration seeds a record on first create but never clobbers
 * these.
 *
 *  - org_install_mode        how an app installs in an ORG context:
 *                            'everyone' (whole org, org-level-only),
 *                            'self' (per-member only), or 'both'.
 *                            Enforced default: an organization-scoped app is
 *                            org-level-by-definition, so it is 'everyone'.
 *  - personal_removable      can a user uninstall it from their personal space?
 *                            false = core/system app on personal (e.g. FuzeAgent).
 *  - org_removable           can an org admin uninstall it from the org?
 *  - system_app              platform-managed/core app (display + intent).
 *  - default_install_personal  auto-installed for every user (personal/self).
 *  - default_install_org       auto-installed for every org (org/everyone).
 *
 * All additive and idempotent; defaults preserve today's behavior for every
 * existing row except org_install_mode, which is backfilled to match the
 * org-level-only rule.
 */
export async function up(knex: Knex): Promise<void> {
  // Native enum for org_install_mode (mirrors the app_install_mode style).
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE app_org_install_mode_enum AS ENUM ('self', 'everyone', 'both');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)

  const hasOrgInstallMode = await knex.schema.hasColumn('apps', 'org_install_mode')
  const hasPersonalRemovable = await knex.schema.hasColumn('apps', 'personal_removable')
  const hasOrgRemovable = await knex.schema.hasColumn('apps', 'org_removable')
  const hasSystemApp = await knex.schema.hasColumn('apps', 'system_app')
  const hasDefaultPersonal = await knex.schema.hasColumn('apps', 'default_install_personal')
  const hasDefaultOrg = await knex.schema.hasColumn('apps', 'default_install_org')

  await knex.schema.alterTable('apps', table => {
    if (!hasOrgInstallMode) {
      table
        .enu('org_install_mode', null, {
          useNative: true,
          existingType: true,
          enumName: 'app_org_install_mode_enum',
        })
        .notNullable()
        .defaultTo('both')
    }
    if (!hasPersonalRemovable) {
      table.boolean('personal_removable').notNullable().defaultTo(true)
    }
    if (!hasOrgRemovable) {
      table.boolean('org_removable').notNullable().defaultTo(true)
    }
    if (!hasSystemApp) {
      table.boolean('system_app').notNullable().defaultTo(false)
    }
    if (!hasDefaultPersonal) {
      table.boolean('default_install_personal').notNullable().defaultTo(false)
    }
    if (!hasDefaultOrg) {
      table.boolean('default_install_org').notNullable().defaultTo(false)
    }
  })

  // Backfill org_install_mode to honor the org-level-only rule and any legacy
  // manifest intent. Organization-scoped apps are whole-org by definition.
  await knex.raw(`
    UPDATE apps SET org_install_mode = 'everyone'
     WHERE scope_level = 'organization'
        OR (manifest->>'orgLevelOnly') = 'true'
        OR (manifest->>'installMode') = 'everyone'
        OR (manifest->>'organizationInstallMode') = 'everyone'
  `)
  await knex.raw(`
    UPDATE apps SET org_install_mode = 'self'
     WHERE scope_level <> 'organization'
       AND (manifest->>'organizationInstallMode') = 'self'
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('apps', table => {
    table.dropColumn('default_install_org')
    table.dropColumn('default_install_personal')
    table.dropColumn('system_app')
    table.dropColumn('org_removable')
    table.dropColumn('personal_removable')
    table.dropColumn('org_install_mode')
  })
  await knex.raw('DROP TYPE IF EXISTS app_org_install_mode_enum')
}
