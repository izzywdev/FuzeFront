import { Knex } from 'knex'

/**
 * Migration 014: L1 referential-integrity projection (FFRNT P2).
 * Idempotent: all CREATE statements use IF NOT EXISTS.
 *
 * sec_ref_index — a LOCAL answer to "does this entity exist", for entities the
 * security-service references but does not own (e.g. portals owned by the
 * host backend). The `sec_` prefix avoids collision on the shared
 * fuzefront_platform database.
 *
 * governance/identifier-standard.md §5, L1 layer.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS sec_ref_index (
      entity_type     TEXT NOT NULL,
      entity_id       TEXT NOT NULL,
      tenant_id       TEXT,
      status          TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'deleted')),
      observed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sec_ref_index_identity_uq
      ON sec_ref_index (entity_type, entity_id, COALESCE(tenant_id, ''))
  `)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS sec_ref_index_active_lookup
      ON sec_ref_index (entity_type, entity_id)
      WHERE status = 'active'
  `)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS sec_ref_index_state (
      id               BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
      last_applied_at  TIMESTAMPTZ
    )
  `)

  await knex.raw(`
    INSERT INTO sec_ref_index_state (id, last_applied_at)
         VALUES (TRUE, NULL)
    ON CONFLICT (id) DO NOTHING
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS sec_ref_index_state')
  await knex.raw('DROP TABLE IF EXISTS sec_ref_index')
}
