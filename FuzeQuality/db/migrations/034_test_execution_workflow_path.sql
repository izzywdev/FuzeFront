-- FQ-206/FQ-214: retain the durable workflow source for execution provenance.
ALTER TABLE fuzequality.test_executions
  ADD COLUMN IF NOT EXISTS workflow_path text;
