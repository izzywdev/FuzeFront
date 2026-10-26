-- FQ-197/FQ-203: preserve which reviewed requirement-analysis dependency
-- failed so the portal can distinguish Jira, FuzeInfra LiteLLM, and semantic
-- retrieval outages without exposing provider response content.
ALTER TABLE fuzequality.sync_cursors
  ADD COLUMN IF NOT EXISTS failure_code text;

ALTER TABLE fuzequality.sync_cursors
  DROP CONSTRAINT IF EXISTS sync_cursors_failure_code_check;

ALTER TABLE fuzequality.sync_cursors
  ADD CONSTRAINT sync_cursors_failure_code_check CHECK (
    failure_code IS NULL OR failure_code IN (
      'JIRA_UNAVAILABLE',
      'INTELLIGENCE_UNAVAILABLE',
      'SEMANTIC_INDEX_UNAVAILABLE'
    )
  );
