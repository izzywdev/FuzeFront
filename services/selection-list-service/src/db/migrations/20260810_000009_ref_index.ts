// Migration 9: the org projection / L1 ref-index store (plan sections 7.1, 13).
//
// Implements the storage behind `RefIndexStore` (packages/identity/src/ref-index.ts), fed by
// identity.org.created / identity.org.deleted (TOPIC_PROJECTIONS), so seeding can check
// "does this org exist" (ORG_UNKNOWN / ORG_INACTIVE) without a network call, and so the
// reconciler can enumerate orgs to backfill.
//
//   entity_type  registry EntityType ('organization' today; 'user'/'portal' allowed by the
//                package). Open TEXT so adding a projected type needs no migration.
//   entity_id    the entity's id in STORAGE form (bare uuid, as the identity.* events carry it).
//                TEXT, not UUID: this service stores every id as TEXT and ref-index's own
//                `storageForm` deliberately falls through to the raw value for legacy ids; a
//                UUID column would make the consumer throw on them instead of projecting.
//   tenant_id    optional scope (RefRecord.tenantId); NULL for organizations.
//   status       'active' | 'deleted'. Deleted is a TOMBSTONE (never DELETE) so a redelivered
//                *.created cannot resurrect a dead row.
//   wire_id      the `org_...` TypeID form (what selection_lists.organization_id and the ledger
//                store), so the reconciler can join projection -> ledger/lists. NULL if unknown.
//   org_type / is_active   from the identity.org.created snapshot: seed packs apply by
//                `appliesTo` (organization|personal; 'platform' excluded by default) and
//                `isActive === false` is skipped. NULL for non-org entity types.
//   updated_at   max(updated_at) IS RefIndexStore.lastAppliedAt(); an empty table IS isEmpty().
//
// Ownership/grants/RLS: see migration 6 header. IDEMPOTENT: IF NOT EXISTS throughout.

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS selection_list_ref_index (
      entity_type TEXT        NOT NULL CHECK (entity_type <> ''),
      entity_id   TEXT        NOT NULL CHECK (entity_id <> ''),
      tenant_id   TEXT,
      status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
      wire_id     TEXT,
      org_type    TEXT        CHECK (org_type IN ('platform','organization','personal')),
      is_active   BOOLEAN,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (entity_type, entity_id)
    )
  `);

  // Reconciler scan: active orgs.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_sl_ref_index_type_status
      ON selection_list_ref_index (entity_type, status)
  `);
  // Join to ledger / lists by wire id.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_sl_ref_index_wire
      ON selection_list_ref_index (entity_type, wire_id)
      WHERE wire_id IS NOT NULL
  `);
  // lastAppliedAt()
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_sl_ref_index_updated_at
      ON selection_list_ref_index (updated_at)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS selection_list_ref_index');
}
