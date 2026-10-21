// Migration 12: the org projection also keeps the org owner's BARE UUID (`owner_uuid`).
//
// The Security API names users to Permit by the bare UUID, so the access mirror (`selection_list_access.user_id`)
// now records the UUID that was actually sent when this service bootstraps an owner (services must send Permit
// keys, see src/lib/permitKeys.ts). The projection's `owner_id` stays the `usr_...` wire id (seeding, events); the
// reconciler's "owner grant still missing" predicate must recognise a mirror row under EITHER form, and SQL cannot
// decode a TypeID, so the UUID is stored next to it. Additive, nullable, IDEMPOTENT; existing rows are back-filled
// with the identity codec. NULL = unknown (the predicate then falls back to the wire id alone).

import type { Knex } from 'knex';
import { toUuid } from '@izzywdev/fuzefront-identity';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE selection_list_ref_index ADD COLUMN IF NOT EXISTS owner_uuid TEXT`);
  const rows: Array<{ entity_type: string; entity_id: string; owner_id: string }> = await knex('selection_list_ref_index')
    .whereNotNull('owner_id')
    .whereNull('owner_uuid')
    .select('entity_type', 'entity_id', 'owner_id');
  for (const r of rows) {
    let uuid: string | null = null;
    try {
      uuid = toUuid(r.owner_id as never);
    } catch {
      // not a codec-valid TypeID: leave NULL
    }
    if (uuid) await knex('selection_list_ref_index').where({ entity_type: r.entity_type, entity_id: r.entity_id }).update({ owner_uuid: uuid });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE selection_list_ref_index DROP COLUMN IF EXISTS owner_uuid`);
}
