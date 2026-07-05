"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.up = up;
exports.down = down;
/**
 * Plan B — provisioning backbone.
 *
 * - Adds 'personal' to the organization type enum (personal workspace orgs).
 * - Tracks per-org Permit provisioning as resumable steps so reconciliation is
 *   idempotent and self-healing.
 * - Adds organization_invitations (used by Plan G; created now).
 * - Adds event_outbox so first-time-user / email events are durably recorded
 *   even if the Kafka publish fails (best-effort publish, guaranteed record).
 *
 * NOTE: no role/DB DDL here — that is the privileged bootstrap's job (A0).
 */
// `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, so this
// migration must not be wrapped in one. Knex honours this per-migration export.
exports.config = { transaction: false };
async function up(knex) {
    // 1. Extend organization_type_enum with 'personal'.
    //    ALTER TYPE ... ADD VALUE cannot run inside a transaction block, and knex
    //    wraps migrations in a transaction by default, so issue it without the
    //    surrounding transaction. IF NOT EXISTS keeps it idempotent.
    await knex.raw(`
    ALTER TYPE organization_type_enum ADD VALUE IF NOT EXISTS 'personal'
  `);
    // 1b. Enforce ≤1 personal org per user at the DB level (C1).
    //     The partial unique index rejects a second personal org for the same owner
    //     with a 23505 error, which ensurePersonalOrg catches as a race win.
    await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_org_per_owner
      ON organizations (owner_id)
      WHERE type = 'personal'
  `);
    // 2. provisioning_state on organizations (derive "active" => all steps done).
    await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE org_provisioning_state_enum AS ENUM ('pending', 'active', 'failed');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
    const hasState = await knex.schema.hasColumn('organizations', 'provisioning_state');
    if (!hasState) {
        await knex.schema.alterTable('organizations', table => {
            table
                .enum('provisioning_state', null, {
                useNative: true,
                existingType: true,
                enumName: 'org_provisioning_state_enum',
            })
                .notNullable()
                .defaultTo('pending');
        });
    }
    // 3. organization_provisioning step table.
    await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE provisioning_step_enum AS ENUM (
        'permit_user_sync', 'permit_tenant_create', 'permit_role_assign', 'welcome_email'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
    await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE provisioning_status_enum AS ENUM ('pending', 'done', 'failed');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
    const hasProvisioning = await knex.schema.hasTable('organization_provisioning');
    if (!hasProvisioning) {
        await knex.schema.createTable('organization_provisioning', table => {
            table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
            table
                .uuid('organization_id')
                .notNullable()
                .references('id')
                .inTable('organizations')
                .onDelete('CASCADE');
            table
                .enum('step', null, {
                useNative: true,
                existingType: true,
                enumName: 'provisioning_step_enum',
            })
                .notNullable();
            table
                .enum('status', null, {
                useNative: true,
                existingType: true,
                enumName: 'provisioning_status_enum',
            })
                .notNullable()
                .defaultTo('pending');
            table.integer('attempts').notNullable().defaultTo(0);
            table.text('last_error').nullable();
            table.timestamps(true, true);
            table.unique(['organization_id', 'step']);
            table.index(['organization_id']);
            table.index(['status']);
        });
    }
    // 4. organization_invitations (Plan G).
    await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE invitation_status_enum AS ENUM ('pending', 'accepted', 'revoked', 'expired');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
    const hasInvites = await knex.schema.hasTable('organization_invitations');
    if (!hasInvites) {
        await knex.schema.createTable('organization_invitations', table => {
            table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
            table
                .uuid('organization_id')
                .notNullable()
                .references('id')
                .inTable('organizations')
                .onDelete('CASCADE');
            table.string('email', 320).notNullable();
            // Reuse the membership role enum so invitations map cleanly to memberships.
            table
                .enum('role', null, {
                useNative: true,
                existingType: true,
                enumName: 'membership_role_enum',
            })
                .notNullable()
                .defaultTo('member');
            table.string('token', 128).notNullable().unique();
            table.timestamp('expires_at').notNullable();
            table
                .enum('status', null, {
                useNative: true,
                existingType: true,
                enumName: 'invitation_status_enum',
            })
                .notNullable()
                .defaultTo('pending');
            table.uuid('invited_by').nullable().references('id').inTable('users');
            table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
            table.index(['organization_id']);
            table.index(['email']);
            table.index(['status']);
        });
    }
    // 5. event_outbox — durable record of events we want to publish to Kafka.
    await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE outbox_status_enum AS ENUM ('pending', 'sent', 'failed');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
    const hasOutbox = await knex.schema.hasTable('event_outbox');
    if (!hasOutbox) {
        await knex.schema.createTable('event_outbox', table => {
            table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
            table.string('topic', 255).notNullable();
            table.jsonb('payload').notNullable();
            table.string('correlation_id', 128).notNullable();
            table
                .enum('status', null, {
                useNative: true,
                existingType: true,
                enumName: 'outbox_status_enum',
            })
                .notNullable()
                .defaultTo('pending');
            table.integer('attempts').notNullable().defaultTo(0);
            table.text('last_error').nullable();
            table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
            table.timestamp('sent_at').nullable();
            table.index(['status']);
            table.index(['topic']);
        });
    }
}
async function down(knex) {
    await knex.schema.dropTableIfExists('event_outbox');
    await knex.schema.dropTableIfExists('organization_invitations');
    await knex.schema.dropTableIfExists('organization_provisioning');
    const hasState = await knex.schema.hasColumn('organizations', 'provisioning_state');
    if (hasState) {
        await knex.schema.alterTable('organizations', table => {
            table.dropColumn('provisioning_state');
        });
    }
    await knex.raw('DROP TYPE IF EXISTS outbox_status_enum');
    await knex.raw('DROP TYPE IF EXISTS invitation_status_enum');
    await knex.raw('DROP TYPE IF EXISTS provisioning_status_enum');
    await knex.raw('DROP TYPE IF EXISTS provisioning_step_enum');
    await knex.raw('DROP TYPE IF EXISTS org_provisioning_state_enum');
    // NOTE: cannot drop the 'personal' value from organization_type_enum
    // (Postgres has no ALTER TYPE ... DROP VALUE); left in place on rollback.
}
//# sourceMappingURL=009_provisioning_backbone.js.map