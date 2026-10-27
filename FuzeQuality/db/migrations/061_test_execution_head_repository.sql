-- FQ-214/FQ-215: retain the repository that supplied a GitHub workflow run's
-- head revision. Branch names alone cannot distinguish a default-branch run
-- from an identically named branch in a pull-request fork.
ALTER TABLE fuzequality.test_executions
  ADD COLUMN IF NOT EXISTS head_repository text;

ALTER TABLE fuzequality.test_execution_versions
  ADD COLUMN IF NOT EXISTS head_repository text;

COMMENT ON COLUMN fuzequality.test_executions.head_repository IS
  'Provider-owned GitHub workflow head repository in owner/name form.';

COMMENT ON COLUMN fuzequality.test_execution_versions.head_repository IS
  'Workflow head repository retained with the immutable lifecycle snapshot.';

CREATE INDEX IF NOT EXISTS test_executions_reviewed_source_idx
  ON fuzequality.test_executions
  (tenant_id, repository_id, branch, lower(head_repository), workflow_path, completed_at DESC, id DESC);
