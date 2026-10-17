-- FQ-204/FQ-206/FQ-212/FQ-214: artifact observations are revision-scoped,
-- while execution and policy/gate analytics need a stable logical identity.
-- Existing rows keep their former identity as a safe legacy boundary; every
-- subsequent scan supplies the deterministic revision-independent identity.
ALTER TABLE fuzequality.repository_quality_artifacts
  ADD COLUMN IF NOT EXISTS logical_id text;

UPDATE fuzequality.repository_quality_artifacts
SET logical_id = id
WHERE logical_id IS NULL;

ALTER TABLE fuzequality.repository_quality_artifacts
  ALTER COLUMN logical_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS repository_quality_artifacts_revision_logical_idx
  ON fuzequality.repository_quality_artifacts (repository_id, revision, logical_id);

CREATE INDEX IF NOT EXISTS repository_quality_artifacts_logical_history_idx
  ON fuzequality.repository_quality_artifacts (repository_id, logical_id, discovered_at DESC, id DESC);
