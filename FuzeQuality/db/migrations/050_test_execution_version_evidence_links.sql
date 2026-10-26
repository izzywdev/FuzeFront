-- FQ-199/FQ-206/FQ-214/FQ-215: evidence-kind filtering must use the same
-- immutable lifecycle snapshot as paged trends and policy/gate aggregates.
ALTER TABLE fuzequality.test_execution_versions
  ADD COLUMN IF NOT EXISTS evidence_links jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Preserve old snapshots exactly as observed. Add a new current-state snapshot
-- for canonical executions that already have attachments instead of rewriting
-- their earlier running/terminal lifecycle evidence.
INSERT INTO fuzequality.test_execution_versions
  (execution_id,repository_id,tenant_id,provider,external_run_id,attempt,revision,kind,status,workflow_path,
   started_at,completed_at,policy_artifact_ids,gate_artifact_ids,gate_evaluations,evidence_links)
SELECT execution.id,execution.repository_id,execution.tenant_id,execution.provider,execution.external_run_id,
       execution.attempt,execution.revision,execution.kind,execution.status,execution.workflow_path,
       execution.started_at,execution.completed_at,execution.policy_artifact_ids,execution.gate_artifact_ids,
       execution.gate_evaluations,execution.evidence_links
FROM fuzequality.test_executions AS execution
WHERE jsonb_array_length(execution.evidence_links) > 0
  AND NOT EXISTS (
    SELECT 1 FROM fuzequality.test_execution_versions AS version
    WHERE version.repository_id = execution.repository_id
      AND version.provider = execution.provider
      AND version.external_run_id = execution.external_run_id
      AND version.attempt = execution.attempt
      AND version.evidence_links = execution.evidence_links
  );

COMMENT ON COLUMN fuzequality.test_execution_versions.evidence_links IS
  'Evidence attachments retained with the immutable execution lifecycle snapshot.';
