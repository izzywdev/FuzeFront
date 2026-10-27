-- FQ-204/FQ-205/FQ-212/FQ-213: keep tenant-scoped remediation queues
-- index-backed as evaluation history grows.
CREATE INDEX IF NOT EXISTS policy_gate_evaluations_remediation_page_idx
  ON fuzequality.policy_gate_evaluations
  (tenant_id, repository_id, remediation_action, created_at DESC, id DESC);
