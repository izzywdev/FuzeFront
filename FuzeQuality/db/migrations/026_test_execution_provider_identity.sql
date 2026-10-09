-- FQ-214: provider-owned run attempts are the durable execution identity.
-- A GitHub rerun increments run_attempt while retaining the same run id and
-- URL; each attempt is evidence and must not overwrite the previous outcome.
ALTER TABLE fuzequality.test_executions
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS external_run_id text,
  ADD COLUMN IF NOT EXISTS attempt integer;

UPDATE fuzequality.test_executions
SET provider = COALESCE(provider, 'external'),
    external_run_id = COALESCE(external_run_id, id),
    attempt = COALESCE(attempt, 1)
WHERE provider IS NULL OR external_run_id IS NULL OR attempt IS NULL;

ALTER TABLE fuzequality.test_executions
  ALTER COLUMN provider SET NOT NULL,
  ALTER COLUMN external_run_id SET NOT NULL,
  ALTER COLUMN attempt SET NOT NULL;

ALTER TABLE fuzequality.test_executions
  DROP CONSTRAINT IF EXISTS test_executions_provider_check,
  DROP CONSTRAINT IF EXISTS test_executions_attempt_check;

ALTER TABLE fuzequality.test_executions
  ADD CONSTRAINT test_executions_provider_check CHECK (provider IN ('github-actions','external')),
  ADD CONSTRAINT test_executions_attempt_check CHECK (attempt > 0);

ALTER TABLE fuzequality.test_executions
  DROP CONSTRAINT IF EXISTS test_executions_repository_id_revision_kind_name_source_url_key;

CREATE UNIQUE INDEX IF NOT EXISTS test_executions_provider_run_attempt_uidx
  ON fuzequality.test_executions (repository_id, provider, external_run_id, attempt);
