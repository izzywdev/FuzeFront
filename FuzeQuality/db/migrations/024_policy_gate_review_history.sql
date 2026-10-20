-- FQ-205/FQ-213: governance decisions are immutable evidence, not a mutable
-- annotation on the latest evaluation row.
CREATE TABLE IF NOT EXISTS fuzequality.policy_gate_review_history (
  id uuid PRIMARY KEY,
  evaluation_id text NOT NULL REFERENCES fuzequality.policy_gate_evaluations(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'dismissed')),
  reviewed_by text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS policy_gate_review_history_evaluation_created_idx
  ON fuzequality.policy_gate_review_history (evaluation_id, created_at DESC);
