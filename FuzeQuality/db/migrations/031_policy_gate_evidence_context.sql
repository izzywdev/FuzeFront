-- FQ-204/FQ-205/FQ-212/FQ-213: persist detector confidence and the exact
-- repository scope used to produce each reviewable policy/gate finding.
ALTER TABLE fuzequality.policy_gate_evaluations
  ADD COLUMN IF NOT EXISTS confidence numeric NOT NULL DEFAULT 1
    CHECK (confidence >= 0 AND confidence <= 1),
  ADD COLUMN IF NOT EXISTS scope jsonb NOT NULL DEFAULT '{"sourcePaths":[],"subjects":[]}'::jsonb;

ALTER TABLE fuzequality.policy_gate_evaluations
  DROP CONSTRAINT IF EXISTS policy_gate_evaluations_scope_object_check;

ALTER TABLE fuzequality.policy_gate_evaluations
  ADD CONSTRAINT policy_gate_evaluations_scope_object_check
  CHECK (jsonb_typeof(scope) = 'object'
    AND jsonb_typeof(scope->'sourcePaths') = 'array'
    AND jsonb_typeof(scope->'subjects') = 'array');
