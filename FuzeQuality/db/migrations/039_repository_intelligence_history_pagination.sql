-- Bound repository-intelligence history scans using the same stable order as
-- the API cursor: newest creation time first, then the immutable row id.
CREATE INDEX IF NOT EXISTS repository_flow_candidates_history_page_idx
  ON fuzequality.repository_flow_candidates
  (tenant_id, repository_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS policy_gate_evaluations_history_page_idx
  ON fuzequality.policy_gate_evaluations
  (tenant_id, repository_id, created_at DESC, id DESC);
