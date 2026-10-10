-- FQ-207: distinguish indexed performance definitions from scanner-verified,
-- manually dispatchable GitHub Actions workflows.
ALTER TABLE fuzequality.repository_quality_artifacts
  ADD COLUMN IF NOT EXISTS execution_target jsonb;

ALTER TABLE fuzequality.repository_quality_artifacts
  DROP CONSTRAINT IF EXISTS repository_quality_artifacts_execution_target_check;

ALTER TABLE fuzequality.repository_quality_artifacts
  ADD CONSTRAINT repository_quality_artifacts_execution_target_check CHECK (
    execution_target IS NULL OR ((
      jsonb_typeof(execution_target) = 'object' AND
      execution_target ?& ARRAY['provider', 'trigger', 'workflowPath'] AND
      kind IN ('load-test', 'stress-test') AND
      execution_target->>'provider' = 'github-actions' AND
      execution_target->>'trigger' = 'workflow_dispatch' AND
      execution_target->>'workflowPath' = source_path AND
      source_path ~ '^\.github/workflows/.+\.ya?ml$'
    ) IS TRUE)
  );
