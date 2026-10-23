-- FQ-207/FQ-214/FQ-215: controlled suite history must survive repository
-- rescans. artifact_id identifies the exact analyzed observation; this column
-- retains the stable workflow identity shared by observations across revisions.
ALTER TABLE fuzequality.test_suite_dispatches
  ADD COLUMN IF NOT EXISTS artifact_logical_id text;

UPDATE fuzequality.test_suite_dispatches AS dispatch
SET artifact_logical_id = COALESCE(
  (
    SELECT artifact.logical_id
    FROM fuzequality.repository_quality_artifacts AS artifact
    WHERE artifact.repository_id = dispatch.repository_id
      AND artifact.id = dispatch.artifact_id
    LIMIT 1
  ),
  dispatch.artifact_id
)
WHERE dispatch.artifact_logical_id IS NULL;

ALTER TABLE fuzequality.test_suite_dispatches
  ALTER COLUMN artifact_logical_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS test_suite_dispatches_logical_history_idx
  ON fuzequality.test_suite_dispatches
  (tenant_id, repository_id, artifact_logical_id, requested_at DESC, id DESC);

COMMENT ON COLUMN fuzequality.test_suite_dispatches.artifact_logical_id IS
  'Stable suite identity across scans; artifact_id remains exact revision provenance.';
