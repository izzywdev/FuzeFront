-- FQ-204/FQ-205/FQ-212/FQ-213: make the proposed governance remediation
-- machine-readable while retaining the detailed human recommendation.
ALTER TABLE fuzequality.policy_gate_evaluations
  ADD COLUMN IF NOT EXISTS remediation_action text;

UPDATE fuzequality.policy_gate_evaluations
SET remediation_action = CASE kind
  WHEN 'unguarded-policy' THEN 'build-gate'
  WHEN 'guard-without-policy' THEN 'build-policy'
  WHEN 'contradictory-policy' THEN 'disambiguate-policy'
  WHEN 'ambiguous-policy' THEN 'disambiguate-policy'
  ELSE 'align-policy-gate'
END
WHERE remediation_action IS NULL;

ALTER TABLE fuzequality.policy_gate_evaluations
  ALTER COLUMN remediation_action SET NOT NULL,
  DROP CONSTRAINT IF EXISTS policy_gate_evaluations_remediation_action_check;

ALTER TABLE fuzequality.policy_gate_evaluations
  ADD CONSTRAINT policy_gate_evaluations_remediation_action_check
  CHECK (remediation_action IN (
    'build-gate','build-policy','disambiguate-policy','align-policy-gate'
  ));
