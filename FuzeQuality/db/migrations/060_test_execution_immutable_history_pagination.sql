-- FQ-206/FQ-207/FQ-214: execution continuations must not move when a running
-- delivery receives its terminal completed_at timestamp.
DROP INDEX IF EXISTS fuzequality.test_executions_history_page_idx;

CREATE INDEX test_executions_history_page_idx
  ON fuzequality.test_executions (
    tenant_id,
    repository_id,
    created_at DESC,
    id DESC
  );
