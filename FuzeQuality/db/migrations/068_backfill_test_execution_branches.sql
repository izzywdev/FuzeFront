-- FQ-206/FQ-214/FQ-215: executions ingested before branch provenance was
-- introduced were accepted only from the repository's default branch. Restore
-- that known provenance so upgraded installations retain their historical CI,
-- integration, post-production, load, and stress evidence in branch-filtered
-- API responses and dashboards.
UPDATE fuzequality.test_executions AS execution
SET branch = repository.default_branch
FROM fuzequality.repositories AS repository
WHERE execution.repository_id = repository.id
  AND execution.provider = 'github-actions'
  AND execution.branch IS NULL;

UPDATE fuzequality.test_execution_versions AS version
SET branch = repository.default_branch
FROM fuzequality.repositories AS repository
WHERE version.repository_id = repository.id
  AND version.provider = 'github-actions'
  AND version.branch IS NULL;
