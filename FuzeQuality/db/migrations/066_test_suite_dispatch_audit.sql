-- Durable, tenant-scoped audit trail for controlled workflow_dispatch requests.
-- Input values are deliberately excluded: analyzed workflows may mark inputs as
-- secrets, while their names are sufficient to prove which reviewed contract
-- was supplied.
CREATE UNIQUE INDEX IF NOT EXISTS repositories_id_tenant_unique
  ON fuzequality.repositories (id, tenant_id);

CREATE TABLE IF NOT EXISTS fuzequality.test_suite_dispatches (
  id uuid PRIMARY KEY,
  repository_id uuid NOT NULL,
  -- repositories.tenant_id is intentionally text because platform tenant
  -- identities are opaque and are not guaranteed to be UUIDs.
  tenant_id text NOT NULL,
  artifact_id text NOT NULL,
  artifact_kind text NOT NULL CHECK (artifact_kind IN (
    'integration-test',
    'post-production-test',
    'load-test',
    'stress-test'
  )),
  workflow_path text NOT NULL,
  source_ref text NOT NULL,
  source_revision text NOT NULL CHECK (source_revision ~ '^[0-9a-fA-F]{40}$'),
  requested_by text NOT NULL,
  input_names jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(input_names) = 'array'),
  status text NOT NULL CHECK (status IN ('dispatching', 'accepted', 'failed')),
  error text,
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT test_suite_dispatches_repository_tenant_fk
    FOREIGN KEY (repository_id, tenant_id)
    REFERENCES fuzequality.repositories(id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS test_suite_dispatches_latest_idx
  ON fuzequality.test_suite_dispatches
  (tenant_id, repository_id, artifact_id, requested_at DESC, id DESC);

COMMENT ON TABLE fuzequality.test_suite_dispatches IS
  'Tenant-scoped dispatch audit. Stores reviewed input names, never workflow input values.';
