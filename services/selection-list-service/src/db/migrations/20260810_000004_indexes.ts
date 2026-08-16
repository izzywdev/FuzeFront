// Migration 4: indexes for hot query paths.
//
// All CREATE INDEX calls use IF NOT EXISTS for idempotency.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_selection_lists_org ON selection_lists(organization_id)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_selection_list_items_list ON selection_list_items(list_id)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_selection_list_items_list_sort ON selection_list_items(list_id, sort_order)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_selection_list_access_list ON selection_list_access(list_id)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_selection_list_access_user ON selection_list_access(user_id)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_selection_list_audit_list ON selection_list_audit(list_id)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_selection_list_audit_at ON selection_list_audit(occurred_at)'
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_selection_list_audit_at');
  await knex.raw('DROP INDEX IF EXISTS idx_selection_list_audit_list');
  await knex.raw('DROP INDEX IF EXISTS idx_selection_list_access_user');
  await knex.raw('DROP INDEX IF EXISTS idx_selection_list_access_list');
  await knex.raw('DROP INDEX IF EXISTS idx_selection_list_items_list_sort');
  await knex.raw('DROP INDEX IF EXISTS idx_selection_list_items_list');
  await knex.raw('DROP INDEX IF EXISTS idx_selection_lists_org');
}
