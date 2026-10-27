-- FQ-204/FQ-205/FQ-212/FQ-213: persist successful policy-to-gate
-- relationships alongside reviewable governance anomalies.
ALTER TABLE fuzequality.policy_gate_evaluations
  DROP CONSTRAINT IF EXISTS policy_gate_evaluations_kind_check;

ALTER TABLE fuzequality.policy_gate_evaluations
  ADD CONSTRAINT policy_gate_evaluations_kind_check
  CHECK (kind IN (
    'guarded-policy','unguarded-policy','guard-without-policy',
    'contradictory-policy','ambiguous-policy'
  ));
