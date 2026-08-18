import { Knex } from 'knex';

/**
 * Migration 003: L1 referential-integrity projection (FFRNT P2).
 * Idempotent: all CREATE statements use IF NOT EXISTS.
 *
 * chat_ref_index — a LOCAL answer to "does this entity exist", for entities
 * this service references but does not own. Chat-service references userId
 * (from JWT) and orgId (from JWT / body) which are owned by the host backend /
 * security-service. The `chat_` prefix prevents collision if this service
 * ever shares a database with other services.
 *
 * governance/identifier-standard.md §5, L1 layer.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS chat_ref_index (
      entity_type     TEXT NOT NULL,
      entity_id       TEXT NOT NULL,
      tenant_id       TEXT,
      status          TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'deleted')),
      observed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS chat_ref_index_identity_uq
      ON chat_ref_index (entity_type, entity_id, COALESCE(tenant_id, ''))
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS chat_ref_index_active_lookup
      ON chat_ref_index (entity_type, entity_id)
      WHERE status = 'active'
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS chat_ref_index_state (
      id               BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
      last_applied_at  TIMESTAMPTZ
    )
  `);

  await knex.raw(`
    INSERT INTO chat_ref_index_state (id, last_applied_at)
         VALUES (TRUE, NULL)
    ON CONFLICT (id) DO NOTHING
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS chat_ref_index_state');
  await knex.raw('DROP TABLE IF EXISTS chat_ref_index');
}
