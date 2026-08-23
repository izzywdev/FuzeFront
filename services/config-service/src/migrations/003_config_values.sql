-- Migration 003: config_values (FFRNT-155 / FF-EPIC-17-S3)
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS everywhere).
--
-- Sparse overrides: one row per (definition, scope_type, scope_id). The
-- ABSENCE of a row means "inherit", not "empty" — see openapi.yaml's
-- "the scope chain" prose. `is_locked` makes a tier's value binding on every
-- tier beneath it; that is enforced in the resolution engine (FFRNT-156),
-- not here.
--
-- `id` is NOT a server-minted TypeID in this PR: no create/read path in
-- FFRNT-154/155/156 puts a value's own id on the wire (EffectiveConfigEntry
-- carries no value id — see openapi.yaml), so gen_random_uuid() is used as an
-- internal-only surrogate key, consistent with every other service's
-- internal-only id columns (e.g. billing.stripe_events.id). If FFRNT-158
-- (writes) later needs to expose a value's id on the wire, that is the point
-- to register the reserved `cvl_` TypeID prefix (already documented in the
-- contract's "Identifiers" section) and switch this column to app-minted, the
-- same way config_namespaces.id and config_key_definitions.id already are.
--
-- POLYMORPHIC scope_id: portal_id / org_id / user_id are entities owned by
-- OTHER services (or other tables in this database that this service does not
-- own), so this is NOT a real FK to three different tables — see the S3 risk
-- note ("a polymorphic scope_id cannot carry a real FK ... mitigate with a
-- validation trigger or service-layer existence check"). CHOSEN: a
-- service-layer check (ValueRepository, see src/repositories/value.repository.ts)
-- that runs assertRef() against the type implied by scope_type before every
-- write — the L0 layer of governance/identifier-standard.md §5. Existence
-- verification (L1+) is not built in this PR.

CREATE TABLE IF NOT EXISTS config.config_values (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id   UUID        NOT NULL REFERENCES config.config_key_definitions(id) ON DELETE CASCADE,
  scope_type      TEXT        NOT NULL CHECK (scope_type IN ('platform', 'portal', 'org', 'user')),
  -- NULL exactly when scope_type = 'platform' (a singleton tier).
  scope_id        UUID,
  CONSTRAINT config_values_scope_id_matches_type CHECK (
    (scope_type = 'platform' AND scope_id IS NULL) OR
    (scope_type <> 'platform' AND scope_id IS NOT NULL)
  ),
  value           JSONB       NOT NULL,
  is_locked       BOOLEAN     NOT NULL DEFAULT FALSE,
  lock_reason     TEXT,
  set_by_user_id  UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UNIQUE (definition_id, scope_type, scope_id) from S3 AC1, implemented as TWO
-- partial unique indexes rather than one plain UNIQUE constraint: Postgres
-- treats NULL <> NULL for uniqueness purposes, so a plain UNIQUE(...) would
-- let the 'platform' singleton tier (scope_id always NULL) acquire unlimited
-- rows per definition instead of at most one.
CREATE UNIQUE INDEX IF NOT EXISTS config_values_unique_platform
  ON config.config_values (definition_id)
  WHERE scope_type = 'platform';

CREATE UNIQUE INDEX IF NOT EXISTS config_values_unique_scoped
  ON config.config_values (definition_id, scope_type, scope_id)
  WHERE scope_type <> 'platform';

-- The resolution engine's hot-path lookup: "every value at any tier in the
-- caller's chain, for this namespace's definitions" — fetched per definition,
-- so an index on the FK is the one that matters most.
CREATE INDEX IF NOT EXISTS config_values_definition_idx
  ON config.config_values (definition_id);

-- Supports "every value at a given scope" (e.g. an org's settings page).
CREATE INDEX IF NOT EXISTS config_values_scope_idx
  ON config.config_values (scope_type, scope_id);
