-- FQ-204/FQ-205/FQ-212/FQ-213: preserve the exact repository statements
-- that caused a deterministic policy/gate finding so review is reproducible.
ALTER TABLE fuzequality.policy_gate_evaluations
  ADD COLUMN IF NOT EXISTS evidence_passages jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE fuzequality.policy_gate_evaluations
  DROP CONSTRAINT IF EXISTS policy_gate_evaluations_evidence_passages_array_check;

ALTER TABLE fuzequality.policy_gate_evaluations
  ADD CONSTRAINT policy_gate_evaluations_evidence_passages_array_check
  CHECK (jsonb_typeof(evidence_passages) = 'array');
