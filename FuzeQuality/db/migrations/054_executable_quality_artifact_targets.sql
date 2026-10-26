-- FQ-199/FQ-206/FQ-207/FQ-214/FQ-215: every reviewed test workflow kind
-- may retain a scanner-verified workflow_dispatch target. Migration 036
-- originally limited this metadata to performance tests; the later kind
-- migrations added integration and post-production inventory without widening
-- the execution-target constraint.
ALTER TABLE fuzequality.repository_quality_artifacts
  DROP CONSTRAINT IF EXISTS repository_quality_artifacts_execution_target_check;

ALTER TABLE fuzequality.repository_quality_artifacts
  ADD CONSTRAINT repository_quality_artifacts_execution_target_check CHECK (
    execution_target IS NULL OR ((
      jsonb_typeof(execution_target) = 'object' AND
      execution_target ?& ARRAY['provider', 'trigger', 'workflowPath'] AND
      kind IN ('integration-test', 'post-production-test', 'load-test', 'stress-test') AND
      execution_target->>'provider' = 'github-actions' AND
      execution_target->>'trigger' = 'workflow_dispatch' AND
      execution_target->>'workflowPath' = source_path AND
      source_path ~ '^\.github/workflows/.+\.ya?ml$'
    ) IS TRUE)
  );

COMMENT ON CONSTRAINT repository_quality_artifacts_execution_target_check
  ON fuzequality.repository_quality_artifacts IS
  'Allows only scanner-verified workflow_dispatch targets for executable test workflow artifacts.';
