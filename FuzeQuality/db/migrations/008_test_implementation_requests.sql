CREATE TABLE IF NOT EXISTS fuzequality.test_implementation_requests (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id),
  source_revision text NOT NULL CHECK (source_revision ~ '^[0-9a-fA-F]{40}$'),
  expectation_ids jsonb NOT NULL,
  idempotency_key text NOT NULL,
  agent_profile text NOT NULL CHECK (agent_profile IN ('test-engineer', 'frontend-test-engineer')),
  skills jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'pr-ready', 'failed')),
  requested_by text NOT NULL,
  workflow_url text,
  pull_request_url text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS test_implementation_requests_repository_idx
  ON fuzequality.test_implementation_requests (tenant_id, repository_id, created_at DESC);
