-- FQ-214/FQ-215: freeze execution state as well as membership for paged
-- policy/gate performance snapshots. Lifecycle upserts keep the canonical row
-- current, while this append-only table preserves the state visible at each
-- ingestion boundary.
CREATE TABLE IF NOT EXISTS fuzequality.test_execution_versions (
  version_id bigserial PRIMARY KEY,
  execution_id text NOT NULL,
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  provider text NOT NULL,
  external_run_id text NOT NULL,
  attempt integer NOT NULL,
  revision text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ci','integration','post-production','load','stress')),
  status text NOT NULL CHECK (status IN ('passed','failed','cancelled','running')),
  workflow_path text,
  started_at timestamptz,
  completed_at timestamptz,
  policy_artifact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  gate_artifact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  gate_evaluations jsonb NOT NULL DEFAULT '[]'::jsonb,
  versioned_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO fuzequality.test_execution_versions
  (execution_id,repository_id,tenant_id,provider,external_run_id,attempt,revision,kind,status,workflow_path,
   started_at,completed_at,policy_artifact_ids,gate_artifact_ids,gate_evaluations,versioned_at)
SELECT id,repository_id,tenant_id,provider,external_run_id,attempt,revision,kind,status,workflow_path,
       started_at,completed_at,policy_artifact_ids,gate_artifact_ids,gate_evaluations,created_at
FROM fuzequality.test_executions AS execution
WHERE NOT EXISTS (
  SELECT 1 FROM fuzequality.test_execution_versions AS version
  WHERE version.repository_id=execution.repository_id
    AND version.provider=execution.provider
    AND version.external_run_id=execution.external_run_id
    AND version.attempt=execution.attempt
);

CREATE INDEX IF NOT EXISTS test_execution_versions_snapshot_idx
  ON fuzequality.test_execution_versions
  (tenant_id,repository_id,versioned_at DESC,provider,external_run_id,attempt,version_id DESC);
