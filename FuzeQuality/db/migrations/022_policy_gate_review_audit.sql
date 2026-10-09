-- FQ-205/FQ-213: retain the FuzeFront actor and optional rationale for a governance decision.
ALTER TABLE fuzequality.policy_gate_evaluations
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS review_reason text;
