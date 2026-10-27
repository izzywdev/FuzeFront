-- Stable keyset indexes for tenant-scoped human review audit history.
CREATE INDEX IF NOT EXISTS repository_flow_review_history_page_idx
  ON fuzequality.repository_flow_review_history
  (tenant_id, candidate_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS policy_gate_review_history_page_idx
  ON fuzequality.policy_gate_review_history
  (tenant_id, evaluation_id, created_at DESC, id DESC);
