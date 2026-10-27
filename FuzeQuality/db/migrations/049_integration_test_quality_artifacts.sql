-- FQ-206/FQ-214/FQ-215: retain repository-derived integration workflow
-- inventory independently from mutable execution history.
ALTER TABLE fuzequality.repository_quality_artifacts
  DROP CONSTRAINT IF EXISTS repository_quality_artifacts_kind_check;

ALTER TABLE fuzequality.repository_quality_artifacts
  ADD CONSTRAINT repository_quality_artifacts_kind_check
  CHECK (kind IN (
    'route','story','documentation','policy','gate','test-plan',
    'integration-test','post-production-test','load-test','stress-test'
  ));
