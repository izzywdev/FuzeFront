"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Create app visibility enum (idempotent)
    await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE app_visibility_enum AS ENUM ('private', 'organization', 'public', 'marketplace');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
    // Add organization-related columns to apps table (each guarded individually)
    if (!await knex.schema.hasColumn('apps', 'organization_id')) {
        await knex.schema.alterTable('apps', table => {
            table
                .uuid('organization_id')
                .nullable()
                .references('id')
                .inTable('organizations')
                .onDelete('CASCADE');
            table.index(['organization_id']);
        });
    }
    if (!await knex.schema.hasColumn('apps', 'visibility')) {
        await knex.schema.alterTable('apps', table => {
            table
                .enum('visibility', null, {
                useNative: true,
                existingType: true,
                enumName: 'app_visibility_enum',
            })
                .defaultTo('private');
            table.index(['visibility']);
        });
    }
    if (!await knex.schema.hasColumn('apps', 'marketplace_metadata')) {
        await knex.schema.alterTable('apps', table => {
            table.jsonb('marketplace_metadata').defaultTo('{}');
        });
    }
    if (!await knex.schema.hasColumn('apps', 'is_marketplace_approved')) {
        await knex.schema.alterTable('apps', table => {
            table.boolean('is_marketplace_approved').defaultTo(false);
            table.index(['is_marketplace_approved']);
        });
    }
    if (!await knex.schema.hasColumn('apps', 'marketplace_submitted_at')) {
        await knex.schema.alterTable('apps', table => {
            table.timestamp('marketplace_submitted_at').nullable();
            table.index(['marketplace_submitted_at']);
        });
    }
    if (!await knex.schema.hasColumn('apps', 'marketplace_approved_at')) {
        await knex.schema.alterTable('apps', table => {
            table.timestamp('marketplace_approved_at').nullable();
        });
    }
    if (!await knex.schema.hasColumn('apps', 'approved_by')) {
        await knex.schema.alterTable('apps', table => {
            table.uuid('approved_by').nullable().references('id').inTable('users');
        });
    }
    if (!await knex.schema.hasColumn('apps', 'install_permissions')) {
        await knex.schema.alterTable('apps', table => {
            table.jsonb('install_permissions').defaultTo('{}');
        });
    }
    if (!await knex.schema.hasColumn('apps', 'install_count')) {
        await knex.schema.alterTable('apps', table => {
            table.integer('install_count').defaultTo(0);
            table.index(['install_count']);
        });
    }
    if (!await knex.schema.hasColumn('apps', 'rating')) {
        await knex.schema.alterTable('apps', table => {
            table.decimal('rating', 3, 2).nullable();
            table.index(['rating']);
        });
    }
    if (!await knex.schema.hasColumn('apps', 'review_count')) {
        await knex.schema.alterTable('apps', table => {
            table.integer('review_count').defaultTo(0);
        });
    }
}
async function down(knex) {
    return knex.schema
        .alterTable('apps', table => {
        table.dropColumn('organization_id');
        table.dropColumn('visibility');
        table.dropColumn('marketplace_metadata');
        table.dropColumn('is_marketplace_approved');
        table.dropColumn('marketplace_submitted_at');
        table.dropColumn('marketplace_approved_at');
        table.dropColumn('approved_by');
        table.dropColumn('install_permissions');
        table.dropColumn('install_count');
        table.dropColumn('rating');
        table.dropColumn('review_count');
    })
        .then(() => {
        return knex.raw('DROP TYPE IF EXISTS app_visibility_enum');
    });
}
//# sourceMappingURL=006_update_apps_for_organizations.js.map