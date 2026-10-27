-- FQ-206/FQ-214/FQ-215: retain provider source-branch provenance for default,
-- pull-request, and other non-default workflow executions. Historical
-- lifecycle snapshots remain immutable; new snapshots carry the branch.
ALTER TABLE fuzequality.test_executions
  ADD COLUMN IF NOT EXISTS branch text;

ALTER TABLE fuzequality.test_execution_versions
  ADD COLUMN IF NOT EXISTS branch text;

CREATE INDEX IF NOT EXISTS test_executions_branch_idx
  ON fuzequality.test_executions
  (tenant_id, repository_id, branch, completed_at DESC, id DESC);

COMMENT ON COLUMN fuzequality.test_executions.branch IS
  'Provider-owned source branch/ref for the exact execution revision.';

COMMENT ON COLUMN fuzequality.test_execution_versions.branch IS
  'Source branch/ref retained with the immutable execution lifecycle snapshot.';
