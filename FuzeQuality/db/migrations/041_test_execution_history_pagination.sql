-- FQ-206/FQ-207/FQ-214: stable tenant-scoped continuation for execution evidence.
CREATE INDEX IF NOT EXISTS test_executions_history_page_idx
  ON fuzequality.test_executions (
    tenant_id,
    repository_id,
    COALESCE(completed_at, started_at, 'epoch'::timestamptz) DESC,
    id DESC
  );
