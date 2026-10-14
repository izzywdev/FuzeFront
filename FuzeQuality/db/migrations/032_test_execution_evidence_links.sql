-- FQ-206/FQ-214: make post-production videos, reports, traces, screenshots,
-- and logs discoverable from the exact immutable execution attempt.
ALTER TABLE fuzequality.test_executions
  ADD COLUMN IF NOT EXISTS evidence_links jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE fuzequality.test_executions
  DROP CONSTRAINT IF EXISTS test_executions_evidence_links_array_check;

ALTER TABLE fuzequality.test_executions
  ADD CONSTRAINT test_executions_evidence_links_array_check
  CHECK (jsonb_typeof(evidence_links) = 'array');
