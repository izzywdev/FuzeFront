-- Migration 004: config_history (FF-EPIC-18 / FFRNT-280)
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS everywhere).
--
-- The append-only change trail `GET /v1/config/history` reads and every
-- `set`/`unset`/`lock`/`unlock` (PUT /v1/config) and `reveal`
-- (POST /v1/config/secrets/reveal) writes — see openapi.yaml
-- `ConfigHistoryEntry` / `listConfigHistory`. Rows are NEVER updated or
-- deleted by this service: a revert or a reveal always APPENDS a new entry
-- rather than touching an existing one (openapi.yaml: "Nothing is ever
-- deleted from this trail and no entry is ever mutated in place").
--
-- IDENTITY: `id` is a native `uuid` column populated by the application from
-- a server-minted TypeID (`cvh_…`, mintId('configHistory')) — same pattern as
-- config_namespaces.id / config_key_definitions.id (migrations 001/002).
--
-- DENORMALIZED `namespace`/`key`: `ConfigHistoryEntry.namespace`/`.key` are
-- TEXT copies taken at write time rather than joined through `definition_id`
-- at read time. A key definition is never hard-deleted (only ever marked
-- `deprecated_at` — migration 002's own doc comment), so the join would
-- always resolve; the denormalization exists purely so `listConfigHistory`'s
-- hot path (filtered by namespace+key+scope) is a single indexed lookup
-- against this table alone, with no join back to config_key_definitions.
-- `definition_id` is still kept (FK, ON DELETE CASCADE) as the authoritative
-- link and for `is_secret`-driven redaction bookkeeping elsewhere.
--
-- scope_type/scope_id mirrors config_values' polymorphic-scope shape exactly
-- (migration 003) — same CHECK invariant, same "not a real FK" reasoning
-- (portal_id/org_id/user_id are owned by other services/tables).

CREATE TABLE IF NOT EXISTS config.config_history (
  id              UUID        PRIMARY KEY,
  definition_id   UUID        NOT NULL REFERENCES config.config_key_definitions(id) ON DELETE CASCADE,
  namespace       TEXT        NOT NULL,
  key             TEXT        NOT NULL,
  scope_type      TEXT        NOT NULL CHECK (scope_type IN ('platform', 'portal', 'org', 'user')),
  -- NULL exactly when scope_type = 'platform' (a singleton tier) — same
  -- invariant as config_values.scope_id (migration 003).
  scope_id        UUID,
  CONSTRAINT config_history_scope_id_matches_type CHECK (
    (scope_type = 'platform' AND scope_id IS NULL) OR
    (scope_type <> 'platform' AND scope_id IS NOT NULL)
  ),
  action          TEXT        NOT NULL CHECK (action IN ('set', 'unset', 'lock', 'unlock', 'reveal')),
  -- Both JSONB and nullable: NOT populated for every (action, redacted)
  -- combination — see openapi.yaml ConfigHistoryEntry.oldValue/.newValue for
  -- exactly which. Always NULL when `redacted` is true, regardless of action.
  old_value       JSONB,
  new_value       JSONB,
  -- True when the key is `isSecret` at the time this entry was written — a
  -- point-in-time copy (not re-derived from config_key_definitions later) so
  -- history stays correct even if a key's isSecret flag is edited afterward.
  redacted        BOOLEAN     NOT NULL DEFAULT FALSE,
  actor_type      TEXT        NOT NULL CHECK (actor_type IN ('user', 'system')),
  -- NULL exactly when actor_type = 'system' (openapi.yaml Actor.actorId).
  actor_id        UUID,
  reason          TEXT,
  -- Self-referential: the history entry a revert replayed (openapi.yaml
  -- ConfigOperation.revertOf / ConfigHistoryEntry.revertOf). No ON DELETE
  -- action needed — history rows are never deleted by this service.
  revert_of       UUID        REFERENCES config.config_history(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The `listConfigHistory` hot path: "every entry for one key at one exact
-- scope, newest first" (openapi.yaml). occurred_at DESC + id DESC gives a
-- stable total keyset order (ties on occurred_at, e.g. two entries written in
-- the same batch, are broken by id) — mirrors config_namespaces' listPage
-- keyset (migration 001 / namespace.repository.ts).
CREATE INDEX IF NOT EXISTS config_history_lookup_idx
  ON config.config_history (namespace, key, scope_type, scope_id, occurred_at DESC, id DESC);

-- Supports the FK join / cascade and any future "history for this
-- definition regardless of scope" query.
CREATE INDEX IF NOT EXISTS config_history_definition_idx
  ON config.config_history (definition_id);
