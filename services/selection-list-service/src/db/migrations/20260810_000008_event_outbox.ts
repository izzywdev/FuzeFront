// Migration 8: transactional outbox (plan section 6). Shape and semantics follow
// backend/src/migrations/009_provisioning_backbone.ts `event_outbox` (id, topic, payload,
// correlation_id, status, attempts, last_error, created_at, sent_at), with differences:
//
//   organization_id  NOT NULL - the per-org ordering key (section 6 step 4: rows are
//                    published in (created_at, id) order PER ORGANIZATION and row N+1 is never
//                    published while row N of the same org is pending retry).
//   seq              BIGINT IDENTITY - strict insertion tiebreak. created_at is the TRANSACTION
//                    start time, so rows written in one transaction tie; id (eventId) is
//                    UUIDv7 and not guaranteed monotonic within a millisecond. The relay should
//                    order by (organization_id, created_at, seq) - seq makes it deterministic.
//   status           TEXT + CHECK instead of a native enum (one less object to migrate).
//   id               UUID supplied by the writer (the eventId, UUIDv7); intentionally NO default,
//                    so there is no pgcrypto/gen_random_uuid dependency and no row without an id.
//
// RELAY CLAIM (for backend-engineer; matches core's drainOutboxOnce):
//   SELECT ... FROM event_outbox WHERE status = 'pending'
//   ORDER BY created_at, seq LIMIT n FOR UPDATE SKIP LOCKED   -- inside the claiming txn
// served by idx_event_outbox_pending (partial, only live rows). Per-org head-of-line
// ordering is the relay's job; the partial index (organization_id, created_at, seq) is the
// access path for "oldest pending row for org X".
//
// 'failed' rows are PARKED (attempts reached the cap, copied to <topic>.dlq) and are NOT
// 'pending', so by default they do not block the org's later rows; the relay decides.
// There is no FK to selection_lists on purpose: an event must outlive a hard-purged list
// (e.g. list.deleted).
//
// Ownership/grants/RLS: see migration 6 header. IDEMPOTENT: IF NOT EXISTS throughout.

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS event_outbox (
      id              UUID        PRIMARY KEY,
      seq             BIGINT      GENERATED ALWAYS AS IDENTITY,
      organization_id TEXT        NOT NULL,
      topic           TEXT        NOT NULL,
      payload         JSONB       NOT NULL,
      correlation_id  TEXT        NOT NULL,
      status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
      attempts        INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      last_error      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at         TIMESTAMPTZ,
      CONSTRAINT ck_event_outbox_sent_at CHECK ((status = 'sent') = (sent_at IS NOT NULL))
    )
  `);

  // seq is the global claim/tiebreak order and must be unique.
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS ux_event_outbox_seq ON event_outbox (seq)');

  // Relay hot path: pending rows only, per-org ordered.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_event_outbox_pending
      ON event_outbox (organization_id, created_at, seq)
      WHERE status = 'pending'
  `);
  // Retention pruning of delivered rows / alerting on parked rows.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_event_outbox_sent_at
      ON event_outbox (sent_at) WHERE status = 'sent'
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_event_outbox_failed
      ON event_outbox (created_at) WHERE status = 'failed'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS event_outbox');
}
