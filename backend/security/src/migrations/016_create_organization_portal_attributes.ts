import { Knex } from 'knex'

/**
 * FF-EPIC-17-S7 — portal CRUD as org-tree operations.
 *
 * Frozen contract: `packages/security/openapi.yaml` tag `portals` (PR #704,
 * `@fuzefront/security-client` 0.7.0). A "portal" is an `organizations` row
 * whose `parent_id` is the platform root (`00000000-0000-0000-0000-000000000010`)
 * AND that carries a row in this NEW extension table — the portal-root
 * attribute + tenant attributes (custom domain / white-label branding /
 * per-portal app catalog mode / reseller billing mode) that ordinary sub-orgs
 * lack.
 *
 * ADDITIVE, NON-DESTRUCTIVE (owner-approved approach, see the story brief):
 * this migration creates ONLY a new `organizations`-keyed extension table. It
 * does NOT touch, migrate, or drop the existing standalone `portals` table
 * (`backend/src/migrations/012_create_portals_table.ts`) — that model is
 * marked SUPERSEDED by the contract but retiring it is an explicit follow-up,
 * not this migration (see the PR body's "scope boundary" note). The two
 * tables coexist: `GET /api/v1/admin/portals` keeps reading `portals`
 * unchanged; `GET /api/v1/security/portals` (this story) reads the org tree +
 * this extension table.
 *
 * Enum type names are prefixed `org_portal_attr_*` — DELIBERATELY distinct
 * from the monolith's `portal_status_enum` / `portal_billing_mode_enum` /
 * etc (012_create_portals_table.ts) even though this service and the
 * monolith share one physical Postgres database in every deployed
 * environment (see 014_seed_root_platform_organization.ts's header) — two
 * independently-evolving schemas must never contend for the same type name.
 *
 * Idempotent: every DDL statement is guarded (`CREATE TYPE ... EXCEPTION WHEN
 * duplicate_object`, `hasTable` check) so running `up()` twice against the
 * same database — including a fresh security-service-only test DB that never
 * ran the monolith's chain — is a clean no-op on the second pass. Mirrors
 * `012_create_portals_table.ts`'s own idempotency pattern.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE org_portal_attr_status_enum AS ENUM (
        'provisioning', 'provisioned-pending-invite', 'active', 'suspended'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE org_portal_attr_billing_mode_enum AS ENUM ('free', 'platform', 'reseller');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE org_portal_attr_app_catalog_mode_enum AS ENUM ('inherit', 'custom');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)

  const hasTable = await knex.schema.hasTable('organization_portal_attributes')
  if (!hasTable) {
    await knex.schema.createTable('organization_portal_attributes', table => {
      // 1:1 extension of `organizations` — the org id IS the key, no
      // separate surrogate id. ON DELETE CASCADE: an org hard-delete (there
      // is none today; org "delete" is a soft is_active=false flip) would
      // otherwise orphan this row.
      table
        .uuid('organization_id')
        .primary()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table.string('custom_domain', 255).nullable()
      table.jsonb('branding').notNullable().defaultTo('{}')
      table
        .enum('billing_mode', null, {
          useNative: true,
          existingType: true,
          enumName: 'org_portal_attr_billing_mode_enum',
        })
        .notNullable()
        .defaultTo('free')
      table
        .enum('app_catalog_mode', null, {
          useNative: true,
          existingType: true,
          enumName: 'org_portal_attr_app_catalog_mode_enum',
        })
        .notNullable()
        .defaultTo('inherit')
      table.string('owner_email', 320).nullable()
      // Always true for a row in this table today (only portals get one
      // inserted) — kept as an explicit column rather than "row exists =>
      // true" so a future non-portal extension use of this table (if ever)
      // cannot be silently misread as a portal.
      table.boolean('is_portal_root').notNullable().defaultTo(true)
      table
        .enum('status', null, {
          useNative: true,
          existingType: true,
          enumName: 'org_portal_attr_status_enum',
        })
        .notNullable()
        .defaultTo('provisioning')
      table.timestamps(true, true)

      table.index(['status'])
      table.index(['is_portal_root'])
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('organization_portal_attributes')
  await knex.raw('DROP TYPE IF EXISTS org_portal_attr_status_enum')
  await knex.raw('DROP TYPE IF EXISTS org_portal_attr_billing_mode_enum')
  await knex.raw('DROP TYPE IF EXISTS org_portal_attr_app_catalog_mode_enum')
}
