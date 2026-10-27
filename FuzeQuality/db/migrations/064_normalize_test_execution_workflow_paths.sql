-- FQ-206/FQ-207/FQ-214/FQ-215: GitHub may qualify workflow_run.path with
-- @ref. Catalog artifacts use the repository-relative path, so canonical and
-- immutable execution evidence must use the same identity for matching.
UPDATE fuzequality.test_executions
SET workflow_path = substring(workflow_path FROM '^(.+\.ya?ml)@.+$')
WHERE workflow_path ~* '^.+\.ya?ml@.+$';

UPDATE fuzequality.test_execution_versions
SET workflow_path = substring(workflow_path FROM '^(.+\.ya?ml)@.+$')
WHERE workflow_path ~* '^.+\.ya?ml@.+$';
