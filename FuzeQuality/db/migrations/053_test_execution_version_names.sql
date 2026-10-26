-- FQ-199/FQ-206/FQ-214/FQ-215: suite-name filtering must use the same
-- immutable lifecycle snapshot as execution trends and policy/gate aggregates.
ALTER TABLE fuzequality.test_execution_versions
  ADD COLUMN IF NOT EXISTS name text;

-- Versions created before the name column existed can only be recovered from
-- their canonical provider identity. Populate every historical lifecycle row
-- before making the field mandatory for future snapshots.
UPDATE fuzequality.test_execution_versions AS version
SET name = execution.name
FROM fuzequality.test_executions AS execution
WHERE version.repository_id = execution.repository_id
  AND version.provider = execution.provider
  AND version.external_run_id = execution.external_run_id
  AND version.attempt = execution.attempt
  AND version.name IS NULL;

ALTER TABLE fuzequality.test_execution_versions
  ALTER COLUMN name SET NOT NULL;

COMMENT ON COLUMN fuzequality.test_execution_versions.name IS
  'Execution suite name retained with the immutable lifecycle snapshot.';
