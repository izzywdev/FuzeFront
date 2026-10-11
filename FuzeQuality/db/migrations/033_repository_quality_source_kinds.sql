ALTER TABLE fuzequality.repository_quality_artifacts
  DROP CONSTRAINT IF EXISTS repository_quality_artifacts_kind_check;

ALTER TABLE fuzequality.repository_quality_artifacts
  ADD CONSTRAINT repository_quality_artifacts_kind_check
  CHECK (kind IN ('route','story','documentation','policy','gate','test-plan','load-test','stress-test'));
