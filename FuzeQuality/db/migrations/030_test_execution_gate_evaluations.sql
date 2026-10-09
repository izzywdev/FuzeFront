-- FQ-206/FQ-214/FQ-215: retain the outcome of each explicit policy/gate pair.
-- Separate policy and gate lists remain as discovery links, but must not be
-- combined into inferred pairs when several of either are present.
ALTER TABLE fuzequality.test_executions
  ADD COLUMN IF NOT EXISTS gate_evaluations jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE fuzequality.test_executions
  DROP CONSTRAINT IF EXISTS test_executions_gate_evaluations_array_check;

ALTER TABLE fuzequality.test_executions
  ADD CONSTRAINT test_executions_gate_evaluations_array_check
  CHECK (jsonb_typeof(gate_evaluations) = 'array');
