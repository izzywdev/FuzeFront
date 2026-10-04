-- Migration 005: config_history right-to-erasure (actor_redacted)
-- Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS, DROP/ADD CONSTRAINT guarded).
--
-- DECIDED 2026-10-04 (the owner decision PR #1156 deferred). On
-- `identity.user.deleted(cascade='hard')` the user's id must be erased from
-- this audit trail under right-to-erasure — but a silent `actor_id = NULL`
-- would be indistinguishable from a system-performed action, since migration
-- 004's invariant is "actor_id is NULL exactly when actor_type = 'system'".
-- So erasure is made EXPLICIT with a dedicated flag rather than overloading
-- the NULL: a redacted row keeps `actor_type = 'user'` (a human acted) while
-- `actor_id` goes NULL and `actor_redacted` goes TRUE.
--
-- THE ONLY IN-PLACE MUTATION THIS TABLE PERMITS. config_history is otherwise
-- append-only (migration 004: "history rows are never deleted by this
-- service"; reverts/reveals APPEND). Actor redaction is the single sanctioned
-- UPDATE, and it changes only WHO (actor_id, actor_redacted) — never WHAT
-- (action / old_value / new_value / occurred_at are untouched), so the trail's
-- integrity as a record of changes is preserved while the identity obligation
-- is met. See src/events/user-deleted.handler.ts.
--
-- Why a UUID sentinel was NOT used (the sibling selection-list-service erases
-- TEXT authorship columns with a '[deleted-user]' string): actor_id is a
-- native uuid surfaced on the API as a TypeID-shaped id. A reserved/all-zeros
-- UUID would be a fabricated id that governance/identifier-standard.md forbids
-- and that every reader would present as a real, lookup-able user. A UUID
-- column takes a flag; a TEXT column takes a sentinel.

ALTER TABLE config.config_history
  ADD COLUMN IF NOT EXISTS actor_redacted BOOLEAN NOT NULL DEFAULT FALSE;

-- Enforce the three-way invariant in the database, not just in a comment.
-- (Migration 004 documented "NULL exactly when actor_type = 'system'" but
-- added no CHECK — the invariant lived only in the append path. It is enforced
-- now, extended for redaction.) Drop-then-add so the migration is re-runnable.
ALTER TABLE config.config_history
  DROP CONSTRAINT IF EXISTS config_history_actor_id_matches_type;
ALTER TABLE config.config_history
  ADD CONSTRAINT config_history_actor_id_matches_type CHECK (
    -- system action: no human id, never redacted (there is no id to erase)
    (actor_type = 'system' AND actor_id IS NULL     AND actor_redacted = FALSE) OR
    -- live user action: id present, not redacted
    (actor_type = 'user'   AND actor_id IS NOT NULL AND actor_redacted = FALSE) OR
    -- erased user action: id removed under right-to-erasure, flag records why
    (actor_type = 'user'   AND actor_id IS NULL     AND actor_redacted = TRUE)
  );

-- The redaction UPDATE's predicate is `WHERE actor_type = 'user' AND
-- actor_id = <deleted user>`; this partial index serves it (and any future
-- "all rows this user authored" lookup) without bloating on the NULL majority.
CREATE INDEX IF NOT EXISTS config_history_actor_id_idx
  ON config.config_history (actor_id)
  WHERE actor_id IS NOT NULL;
