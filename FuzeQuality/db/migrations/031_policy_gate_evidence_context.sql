-- FQ-204/FQ-205/FQ-212/FQ-213: persist detector confidence and the exact
-- repository scope used to produce each reviewable policy/gate finding.
ALTER TABLE fuzequality.policy_gate_evaluations
  ADD COLUMN IF NOT EXISTS confidence numeric NOT NULL DEFAULT 1
    CHECK (confidence >= 0 AND confidence <= 1),
  ADD COLUMN IF NOT EXISTS scope jsonb NOT NULL DEFAULT '{"sourcePaths":["legacy://unknown"],"subjects":[]}'::jsonb;

-- A previous application of this migration may have installed the original
-- empty sourcePaths default. Keep reruns corrective and represent rows created
-- before evidence-scoped analysis with an explicit, API-valid legacy marker.
ALTER TABLE fuzequality.policy_gate_evaluations
  ALTER COLUMN scope SET DEFAULT '{"sourcePaths":["legacy://unknown"],"subjects":[]}'::jsonb;

UPDATE fuzequality.policy_gate_evaluations
SET scope = '{"sourcePaths":["legacy://unknown"],"subjects":[]}'::jsonb
WHERE NOT CASE
  WHEN jsonb_typeof(scope) = 'object'
    AND jsonb_typeof(scope->'sourcePaths') = 'array'
    AND jsonb_typeof(scope->'subjects') = 'array'
  THEN jsonb_array_length(scope->'sourcePaths') > 0
  ELSE false
END;

ALTER TABLE fuzequality.policy_gate_evaluations
  DROP CONSTRAINT IF EXISTS policy_gate_evaluations_scope_object_check;

ALTER TABLE fuzequality.policy_gate_evaluations
  ADD CONSTRAINT policy_gate_evaluations_scope_object_check
  CHECK (jsonb_typeof(scope) = 'object'
    AND jsonb_typeof(scope->'sourcePaths') = 'array'
    AND CASE
      WHEN jsonb_typeof(scope->'sourcePaths') = 'array'
      THEN jsonb_array_length(scope->'sourcePaths') > 0
      ELSE false
    END
    AND jsonb_typeof(scope->'subjects') = 'array');
