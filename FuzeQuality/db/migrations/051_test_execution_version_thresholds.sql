-- FQ-199/FQ-207/FQ-214/FQ-215: threshold-outcome filtering must use the same
-- immutable lifecycle snapshot as paged trends and policy/gate aggregates.
ALTER TABLE fuzequality.test_execution_versions
  ADD COLUMN IF NOT EXISTS thresholds jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Keep old lifecycle snapshots immutable. Append a current-state snapshot for
-- canonical executions that already contain evaluated threshold measurements.
INSERT INTO fuzequality.test_execution_versions
  (execution_id,repository_id,tenant_id,provider,external_run_id,attempt,revision,kind,status,workflow_path,
   started_at,completed_at,policy_artifact_ids,gate_artifact_ids,gate_evaluations,thresholds,evidence_links)
SELECT execution.id,execution.repository_id,execution.tenant_id,execution.provider,execution.external_run_id,
       execution.attempt,execution.revision,execution.kind,execution.status,execution.workflow_path,
       execution.started_at,execution.completed_at,execution.policy_artifact_ids,execution.gate_artifact_ids,
       execution.gate_evaluations,execution.thresholds,execution.evidence_links
FROM fuzequality.test_executions AS execution
WHERE jsonb_array_length(execution.thresholds) > 0
  AND NOT EXISTS (
    SELECT 1 FROM fuzequality.test_execution_versions AS version
    WHERE version.repository_id = execution.repository_id
      AND version.provider = execution.provider
      AND version.external_run_id = execution.external_run_id
      AND version.attempt = execution.attempt
      AND version.thresholds = execution.thresholds
      AND version.evidence_links = execution.evidence_links
  );

COMMENT ON COLUMN fuzequality.test_execution_versions.thresholds IS
  'Evaluated threshold measurements retained with the immutable execution lifecycle snapshot.';
