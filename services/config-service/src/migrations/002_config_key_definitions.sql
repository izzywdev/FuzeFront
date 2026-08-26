-- Migration 002: config_key_definitions (FFRNT-154 / FF-EPIC-17-S2)
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS everywhere).
--
-- The catalog: what a key IS (presentation, validation, where it may be set,
-- who may change it) — see services/config-service/openapi.yaml `KeyDefinition`.
--
-- IDENTITY: `id` is a native `uuid` column populated by the application from a
-- server-minted TypeID (`ckd_…`, mintId('keyDefinition')); no DEFAULT, same
-- reasoning as config_namespaces.id (migration 001).
--
-- `namespace_id` -> config_namespaces(id) IS a real FK: both tables are owned
-- by THIS service in THIS database, so an intra-service FK is safe (unlike a
-- cross-service reference, which never gets one — see CLAUDE.md "reference
-- cross-service entities by ID, no cross-service FK").

CREATE TABLE IF NOT EXISTS config.config_key_definitions (
  id                UUID        PRIMARY KEY,
  namespace_id      UUID        NOT NULL REFERENCES config.config_namespaces(id) ON DELETE CASCADE,
  key               TEXT        NOT NULL,
  display_name      TEXT        NOT NULL,
  description       TEXT,
  help_url          TEXT,
  category          TEXT,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  tags              JSONB       NOT NULL DEFAULT '[]'::jsonb,
  value_type        TEXT        NOT NULL CHECK (
                        value_type IN (
                          'string', 'number', 'boolean', 'enum', 'json',
                          'duration', 'url', 'email', 'color', 'secret'
                        )
                      ),
  schema            JSONB,
  enum_values       JSONB,
  -- Always present (S2 AC1) — the bottom of the resolution chain. Stored as
  -- JSONB so any JSON-representable value (including JSON `null`, `false`,
  -- `0`, `""`) round-trips without colliding with SQL NULL: 'null'::jsonb IS
  -- NOT NULL at the column level, so NOT NULL below still holds even when a
  -- key's default is JSON null.
  default_value     JSONB       NOT NULL,
  -- The tiers this key may be set at. A small, fixed-cardinality enum array,
  -- so a native TEXT[] (queried with `= ANY(allowed_scopes)`) is used rather
  -- than JSONB.
  allowed_scopes    TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_system         BOOLEAN     NOT NULL DEFAULT FALSE,
  is_hidden         BOOLEAN     NOT NULL DEFAULT FALSE,
  is_secret         BOOLEAN     NOT NULL DEFAULT FALSE,
  is_readonly       BOOLEAN     NOT NULL DEFAULT FALSE,
  precedence        TEXT        NOT NULL DEFAULT 'most-specific-wins'
                      CHECK (precedence IN ('most-specific-wins', 'least-specific-wins')),
  requires_restart  BOOLEAN     NOT NULL DEFAULT FALSE,
  deprecated_at     TIMESTAMPTZ,
  replaced_by       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (namespace_id, key)
);

CREATE INDEX IF NOT EXISTS config_key_definitions_namespace_category_idx
  ON config.config_key_definitions (namespace_id, category);
