import { Knex } from 'knex'

/**
 * FF-EPIC-09-S1 / FF-EPIC-10-S1 — portals + portal_domains schema.
 *
 * `portals` is the first-class multi-tenant-portal object: a 1:1 wrapper around
 * an `organizations` row (unique `organization_id` FK) that carries lifecycle
 * status, white-label branding, identity policy, and billing mode. `portal_id`
 * is a server-issued, prefixed string id (`prt_<...>`, matching the frozen
 * `services/portal-service/openapi.yaml` `PortalId` pattern) rather than a raw
 * uuid, so it is safe to hand to clients without leaking internal row order.
 *
 * `portal_domains` binds one or more domains (subdomain / path / custom) to a
 * portal, with verification + TLS status (custom-domain verification itself is
 * FF-EPIC-16 — this schema only records the columns).
 *
 * This migration is schema-only (idempotent DDL, `hasTable`-guarded). The root
 * portal seed (FF-EPIC-09-S1 AC2-4) is intentionally NOT done here — at
 * migration-run time this app has no guaranteed users/organizations yet (a
 * fresh install runs migrations before any user exists), and organizations.
 * owner_id is NOT NULL. Doing FK-dependent data provisioning inside DDL would
 * either fail on a fresh install or require unsafe placeholder rows. Instead
 * `ensureRootPortal()` (src/repositories/portalRepository.ts) is an idempotent,
 * self-healing function — the same pattern already used for
 * `ensurePersonalOrg`/`reconcileOrganizationProvisioning` — invoked once
 * `initializeDatabase()` completes (src/config/database.ts) and covered by its
 * own tests (fresh DB, idempotent re-run, and the fail-loud orphan case).
 */

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE portal_status_enum AS ENUM (
        'provisioning', 'provisioned-pending-invite', 'active', 'suspended'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE portal_billing_mode_enum AS ENUM ('free', 'platform', 'reseller');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE portal_domain_kind_enum AS ENUM ('subdomain', 'path', 'custom');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE portal_verification_status_enum AS ENUM ('pending', 'verified', 'failed');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE portal_tls_status_enum AS ENUM ('none', 'pending', 'issued', 'failed');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)

  const hasPortals = await knex.schema.hasTable('portals')
  if (!hasPortals) {
    await knex.schema.createTable('portals', table => {
      // Server-issued prefixed id (`prt_...`), not a raw uuid — see module doc.
      table.string('id', 44).primary()
      table
        .uuid('organization_id')
        .notNullable()
        .unique()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table.string('slug', 40).notNullable().unique()
      table.string('name', 120).notNullable()
      table
        .enum('status', null, {
          useNative: true,
          existingType: true,
          enumName: 'portal_status_enum',
        })
        .notNullable()
        .defaultTo('provisioning')
      table
        .enum('billing_mode', null, {
          useNative: true,
          existingType: true,
          enumName: 'portal_billing_mode_enum',
        })
        .notNullable()
        .defaultTo('free')
      table.jsonb('branding').notNullable().defaultTo('{}')
      table.jsonb('identity_policy').notNullable().defaultTo('{}')
      table.string('owner_email', 320).nullable()
      // True only for the single seeded root portal (slug `fuzefront`) — refuses
      // suspend (409 ROOT_PORTAL_PROTECTED) in the FF-EPIC-09-S3 CRUD API.
      table.boolean('is_root').notNullable().defaultTo(false)
      table.timestamps(true, true)

      table.index(['status'])
      table.index(['is_root'])
    })
  }

  const hasDomains = await knex.schema.hasTable('portal_domains')
  if (!hasDomains) {
    await knex.schema.createTable('portal_domains', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
      table
        .string('portal_id', 44)
        .notNullable()
        .references('id')
        .inTable('portals')
        .onDelete('CASCADE')
      table.string('domain', 255).notNullable().unique()
      table
        .enum('kind', null, {
          useNative: true,
          existingType: true,
          enumName: 'portal_domain_kind_enum',
        })
        .notNullable()
      table.boolean('is_primary').notNullable().defaultTo(false)
      table
        .enum('verification_status', null, {
          useNative: true,
          existingType: true,
          enumName: 'portal_verification_status_enum',
        })
        .notNullable()
        .defaultTo('pending')
      table
        .enum('tls_status', null, {
          useNative: true,
          existingType: true,
          enumName: 'portal_tls_status_enum',
        })
        .notNullable()
        .defaultTo('none')
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now())

      table.index(['portal_id'])
      table.index(['kind'])
    })

    // At most one primary domain per portal (partial unique index — mirrors the
    // `uq_personal_org_per_owner` pattern in 009_provisioning_backbone.ts).
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_domains_one_primary
        ON portal_domains (portal_id)
        WHERE is_primary = true
    `)
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('portal_domains')
  await knex.schema.dropTableIfExists('portals')

  await knex.raw('DROP TYPE IF EXISTS portal_tls_status_enum')
  await knex.raw('DROP TYPE IF EXISTS portal_verification_status_enum')
  await knex.raw('DROP TYPE IF EXISTS portal_domain_kind_enum')
  await knex.raw('DROP TYPE IF EXISTS portal_billing_mode_enum')
  await knex.raw('DROP TYPE IF EXISTS portal_status_enum')
}
