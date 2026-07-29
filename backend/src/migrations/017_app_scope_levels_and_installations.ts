import { Knex } from 'knex'

/**
 * App install scopes.
 *
 * `apps` already answers two questions: who OWNS an app (`organization_id`,
 * migration 006) and who may SEE it (`visibility`). Neither answers who an app
 * may be INSTALLED for, and there is no installation record at all — an app is
 * either registered to an org or it isn't.
 *
 * This migration adds the third question:
 *
 *   apps.scope_level      personal | organization | both
 *   app_installations     one row per actual installation
 *
 * `scope_level` defaults to 'both'. Every app registered under the current
 * org-centric model still works, and nothing about those apps forbids a
 * personal install. Installation is not the authorization boundary — visibility,
 * org membership and Permit still gate what a caller may see and do — so the
 * permissive default does not widen access.
 *
 * NOTE ON NAMING: `apps.scope` already exists and means the Module-Federation
 * remote container name (webpack scope). The new column is deliberately
 * `scope_level`, never `scope`, so the two can never be confused.
 *
 * Shape is enforced in the DATABASE, not only in the route:
 *   - a CHECK constraint pins which anchor columns each (scope, install_mode)
 *     combination must and must not carry;
 *   - three PARTIAL UNIQUE indexes make "install" idempotent per target.
 *
 * The partial indexes are scoped to `status = 'active'` precisely so uninstall
 * can be a soft revoke: an app may be uninstalled and reinstalled without
 * colliding with a stale row.
 */

const INSTALL_SHAPE_CHECK = 'app_installations_shape_check'

export async function up(knex: Knex): Promise<void> {
  // --- enums (idempotent) ---------------------------------------------------
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE app_scope_level_enum AS ENUM ('personal', 'organization', 'both');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE app_install_scope_enum AS ENUM ('personal', 'organization');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE app_install_mode_enum AS ENUM ('self', 'everyone');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE app_install_status_enum AS ENUM ('active', 'revoked');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  // --- apps.scope_level -----------------------------------------------------
  if (!(await knex.schema.hasColumn('apps', 'scope_level'))) {
    await knex.schema.alterTable('apps', table => {
      table
        .enum('scope_level', null, {
          useNative: true,
          existingType: true,
          enumName: 'app_scope_level_enum',
        })
        .notNullable()
        .defaultTo('both')
      table.index(['scope_level'])
    })
  }

  // --- app_installations ----------------------------------------------------
  if (!(await knex.schema.hasTable('app_installations'))) {
    await knex.schema.createTable('app_installations', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))

      table
        .uuid('app_id')
        .notNullable()
        .references('id')
        .inTable('apps')
        .onDelete('CASCADE')

      table.enum('scope', null, {
        useNative: true,
        existingType: true,
        enumName: 'app_install_scope_enum',
      })
        .notNullable()

      // Personal installs are always 'self'; 'everyone' is only meaningful for
      // an organization-scoped install.
      table.enum('install_mode', null, {
        useNative: true,
        existingType: true,
        enumName: 'app_install_mode_enum',
      })
        .notNullable()
        .defaultTo('self')

      // Anchors. Which of these is set is decided by (scope, install_mode) and
      // enforced by INSTALL_SHAPE_CHECK below.
      table
        .uuid('user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .uuid('organization_id')
        .nullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table
        .uuid('installed_by')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.enum('status', null, {
        useNative: true,
        existingType: true,
        enumName: 'app_install_status_enum',
      })
        .notNullable()
        .defaultTo('active')

      table.jsonb('settings').notNullable().defaultTo('{}')
      table.timestamp('revoked_at').nullable()
      table
        .uuid('revoked_by')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamps(true, true)

      table.index(['app_id'])
      table.index(['user_id'])
      table.index(['organization_id'])
      table.index(['status'])
    })
  }

  // The shape constraint. Written raw because knex has no expression-CHECK API
  // that survives the enum casts cleanly.
  const shapeExists = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = ?`,
    [INSTALL_SHAPE_CHECK]
  )
  if (shapeExists.rows.length === 0) {
    await knex.raw(`
      ALTER TABLE app_installations
        ADD CONSTRAINT ${INSTALL_SHAPE_CHECK} CHECK (
          (
            scope = 'personal'
            AND user_id IS NOT NULL
            AND organization_id IS NULL
            AND install_mode = 'self'
          )
          OR
          (
            scope = 'organization'
            AND organization_id IS NOT NULL
            AND (
              (install_mode = 'self'     AND user_id IS NOT NULL) OR
              (install_mode = 'everyone' AND user_id IS NULL)
            )
          )
        );
    `)
  }

  // Idempotency per target. Partial on status='active' so a revoked row never
  // blocks a reinstall.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS app_installations_personal_unique
      ON app_installations (app_id, user_id)
      WHERE scope = 'personal' AND status = 'active';
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS app_installations_org_everyone_unique
      ON app_installations (app_id, organization_id)
      WHERE scope = 'organization' AND install_mode = 'everyone' AND status = 'active';
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS app_installations_org_self_unique
      ON app_installations (app_id, organization_id, user_id)
      WHERE scope = 'organization' AND install_mode = 'self' AND status = 'active';
  `)

  // The hot read: "what is installed for me, here". Covers both the personal
  // lookup and the org-self lookup.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS app_installations_effective_idx
      ON app_installations (user_id, organization_id, status);
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('app_installations')

  if (await knex.schema.hasColumn('apps', 'scope_level')) {
    await knex.schema.alterTable('apps', table => {
      table.dropColumn('scope_level')
    })
  }

  await knex.raw('DROP TYPE IF EXISTS app_install_status_enum')
  await knex.raw('DROP TYPE IF EXISTS app_install_mode_enum')
  await knex.raw('DROP TYPE IF EXISTS app_install_scope_enum')
  await knex.raw('DROP TYPE IF EXISTS app_scope_level_enum')
}
