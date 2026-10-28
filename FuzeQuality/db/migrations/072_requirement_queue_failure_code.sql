-- FQ-197/FQ-203: distinguish event-delivery failure from Jira, LiteLLM, and
-- semantic-index outages so a queued cursor cannot hide a failed dispatch.
ALTER TABLE fuzequality.sync_cursors
  DROP CONSTRAINT IF EXISTS sync_cursors_failure_code_check;

ALTER TABLE fuzequality.sync_cursors
  ADD CONSTRAINT sync_cursors_failure_code_check CHECK (
    failure_code IS NULL OR failure_code IN (
      'JIRA_UNAVAILABLE',
      'REQUIREMENT_QUEUE_UNAVAILABLE',
      'INTELLIGENCE_UNAVAILABLE',
      'INTELLIGENCE_TIMEOUT',
      'INTELLIGENCE_INVALID_RESPONSE',
      'SEMANTIC_INDEX_UNAVAILABLE'
    )
  );
