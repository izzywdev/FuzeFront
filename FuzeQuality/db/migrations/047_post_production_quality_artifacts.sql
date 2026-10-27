-- FQ-199/FQ-206: retain repository-derived post-production workflow inventory
-- independently from mutable execution history.
ALTER TABLE fuzequality.repository_quality_artifacts
  DROP CONSTRAINT IF EXISTS repository_quality_artifacts_kind_check;

ALTER TABLE fuzequality.repository_quality_artifacts
  ADD CONSTRAINT repository_quality_artifacts_kind_check
  CHECK (kind IN (
    'route','story','documentation','policy','gate','test-plan',
    'post-production-test','load-test','stress-test'
  ));
