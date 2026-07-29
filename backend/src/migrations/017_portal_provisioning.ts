import { Knex } from 'knex'

/**
 * FF-EPIC-09-S2 — resumable portal provisioning backbone.
 *
 * Mirrors the pattern established by `009_provisioning_backbone.ts`
 * (`organization_provisioning`): a per-step resumable ledger so
 * `createPortal` (services/portalProvisioning.ts) can be re-triggered after a
 * mid-step failure and resume from the failed step without re-creating prior
 * resources (AC2), while a Postgres advisory lock (`hashtext(slug)`) serializes
 * concurrent same-slug requests (AC3).
 *
 * Keyed by `slug` (NOT `portal_id`) — unlike `organization_provisioning`,
 * which reconciles an ALREADY-EXISTING organization, portal provisioning
 * creates the organization AND the portal row itself as steps of the
 * pipeline, so no stable id exists yet when the first step runs. `slug` is
 * caller-supplied, immutable, and unique (mirrors `portals.slug`), so it is
 * the natural idempotency/request key for the whole pipeline.
 *
 * Reuses the existing `provisioning_status_enum` ('pending' | 'done' |
 * 'failed') from migration 009 rather than declaring a duplicate.
 */

// ALTER-free — this migration only creates new types/tables, so it can stay
// inside the default transaction (unlike 009/016, which ALTER an existing
// enum in place).

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE portal_provisioning_step_enum AS ENUM (
        'org_create',
        'permit_tenant_create',
        'permit_org_instance',
        'permit_org_parent',
        'portal_row_create',
        'default_domain_create',
        'owner_invite'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)

  const hasTable = await knex.schema.hasTable('portal_provisioning')
  if (!hasTable) {
    await knex.schema.createTable('portal_provisioning', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
      // The request key — see module doc. NOT a FK (the slug may not resolve
      // to any row yet on the very first attempt).
      table.string('slug', 40).notNullable()
      table
        .enum('step', null, {
          useNative: true,
          existingType: true,
          enumName: 'portal_provisioning_step_enum',
        })
        .notNullable()
      table
        .enum('status', null, {
          useNative: true,
          existingType: true,
          enumName: 'provisioning_status_enum',
        })
        .notNullable()
        .defaultTo('pending')
      table.integer('attempts').notNullable().defaultTo(0)
      table.text('last_error').nullable()
      // Filled in once the corresponding step completes, so later steps (and
      // a resumed run) can look these up without re-deriving them.
      table
        .uuid('organization_id')
        .nullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .string('portal_id', 44)
        .nullable()
        .references('id')
        .inTable('portals')
        .onDelete('CASCADE')
      table.timestamps(true, true)

      table.unique(['slug', 'step'])
      table.index(['slug'])
      table.index(['status'])
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('portal_provisioning')
  await knex.raw('DROP TYPE IF EXISTS portal_provisioning_step_enum')
}
