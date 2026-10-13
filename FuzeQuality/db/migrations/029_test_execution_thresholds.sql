-- FQ-207/FQ-214/FQ-215: preserve measurable load/stress and quality-gate
-- thresholds with the immutable provider run attempt. Producers submit only
-- observations and targets; the API derives each pass/fail value.
ALTER TABLE fuzequality.test_executions
  ADD COLUMN IF NOT EXISTS thresholds jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE fuzequality.test_executions
  DROP CONSTRAINT IF EXISTS test_executions_thresholds_array_check;

ALTER TABLE fuzequality.test_executions
  ADD CONSTRAINT test_executions_thresholds_array_check
  CHECK (jsonb_typeof(thresholds) = 'array');
