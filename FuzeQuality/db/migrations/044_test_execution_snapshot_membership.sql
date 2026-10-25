-- FQ-214/FQ-215: immutable membership boundary for paged performance snapshots.
CREATE INDEX IF NOT EXISTS test_executions_snapshot_membership_idx
  ON fuzequality.test_executions (tenant_id, repository_id, created_at DESC);
