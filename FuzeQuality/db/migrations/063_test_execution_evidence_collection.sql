-- FQ-214/FQ-215: distinguish a successful provider lookup that found no
-- artifacts from a lookup that could not complete. The same state is retained
-- in immutable execution versions so historical dashboards do not rewrite an
-- unavailable collection as an empty successful result.
ALTER TABLE fuzequality.test_executions
  ADD COLUMN IF NOT EXISTS evidence_collection jsonb;

ALTER TABLE fuzequality.test_executions
  DROP CONSTRAINT IF EXISTS test_executions_evidence_collection_object_check;
ALTER TABLE fuzequality.test_executions
  ADD CONSTRAINT test_executions_evidence_collection_object_check
  CHECK (evidence_collection IS NULL OR jsonb_typeof(evidence_collection) = 'object');

ALTER TABLE fuzequality.test_execution_versions
  ADD COLUMN IF NOT EXISTS evidence_collection jsonb;

ALTER TABLE fuzequality.test_execution_versions
  DROP CONSTRAINT IF EXISTS test_execution_versions_evidence_collection_object_check;
ALTER TABLE fuzequality.test_execution_versions
  ADD CONSTRAINT test_execution_versions_evidence_collection_object_check
  CHECK (evidence_collection IS NULL OR jsonb_typeof(evidence_collection) = 'object');

COMMENT ON COLUMN fuzequality.test_executions.evidence_collection IS
  'Bounded provider artifact discovery outcome for this exact execution attempt.';
COMMENT ON COLUMN fuzequality.test_execution_versions.evidence_collection IS
  'Immutable provider artifact discovery outcome at this ingestion boundary.';
