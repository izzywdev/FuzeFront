-- Migration 004: L1 referential-integrity projection (FFRNT-184)
-- Idempotent: safe to re-run (all CREATE statements use IF NOT EXISTS).
--
-- LEAST-PRIVILEGE: executed at billing-service startup by the runtime role
-- `billing_svc` (see 001_billing_schema.sql header) — schema-level DDL only,
-- no CREATE EXTENSION / CREATE SCHEMA.
--
-- billing.ref_index
-- A LOCAL answer to "does this entity exist", for entities this service does
-- not own. Customers live here; users, organizations and portals do not, and
-- they are in different databases — so there is no foreign key to declare and
-- no shared unique index to lean on (governance/identifier-standard.md §5).
--
-- Fed by the lifecycle events the owning services ALREADY publish
-- (identity.user.*, identity.org.*, portal.created). Nothing new is emitted for
-- this: an event contract that only the integrity layer consumes is one nobody
-- maintains.
--
-- Why a projection rather than a verify-on-write RPC: a local indexed read has
-- no cache-invalidation problem and keeps answering when the owning service is
-- down. The cost is that it is EVENTUALLY consistent, which the read path
-- handles explicitly via `last_applied_at` below rather than pretending away.
CREATE TABLE IF NOT EXISTS billing.ref_index (
  entity_type     TEXT NOT NULL,
  -- STORAGE form (bare uuid), not the wire form. Every identity.* event
  -- declares z.string().uuid(), and §2 puts the prefix on the wire while the
  -- column stays native — so one projection serves both id forms.
  entity_id       TEXT NOT NULL,
  -- Nullable: not every lifecycle event carries a tenant scope. The empty
  -- string in the key expression below is what makes the unique index work
  -- across NULL, since NULL never equals NULL in a UNIQUE constraint and the
  -- row would otherwise be insertable an unbounded number of times.
  tenant_id       TEXT,
  -- 'deleted' is a TOMBSTONE, never a DELETE. Consumers redeliver freely and
  -- Kafka guarantees no ordering across partitions, so a redelivered
  -- `*.created` must not be able to resurrect an entity that was removed.
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ref_index_identity_uq
  ON billing.ref_index (entity_type, entity_id, COALESCE(tenant_id, ''));

-- The read path is exactly this predicate, and it is the reason L1 costs a
-- local index probe instead of a network round trip.
CREATE INDEX IF NOT EXISTS ref_index_active_lookup
  ON billing.ref_index (entity_type, entity_id)
  WHERE status = 'active';

-- billing.ref_index_state
-- One row. Records when the projection last applied an event, so the read path
-- can tell "this entity does not exist" apart from "the projection has not
-- caught up". Without that distinction a Kafka outage turns the projection into
-- a reject-everything oracle and takes the write path down with the bus.
CREATE TABLE IF NOT EXISTS billing.ref_index_state (
  id               BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  last_applied_at  TIMESTAMPTZ
);

INSERT INTO billing.ref_index_state (id, last_applied_at)
     VALUES (TRUE, NULL)
ON CONFLICT (id) DO NOTHING;
