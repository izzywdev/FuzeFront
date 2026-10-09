-- FQ-206/FQ-207/FQ-214: execution evidence is tenant- and revision-scoped.
CREATE TABLE IF NOT EXISTS fuzequality.test_executions (
  id text PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  revision text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ci','integration','post-production','load','stress')),
  status text NOT NULL CHECK (status IN ('passed','failed','cancelled','running')),
  name text NOT NULL,
  source_url text,
  started_at timestamptz,
  completed_at timestamptz,
  policy_artifact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  gate_artifact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository_id, revision, kind, name, source_url)
);
CREATE INDEX IF NOT EXISTS test_executions_tenant_idx ON fuzequality.test_executions (tenant_id, repository_id, completed_at DESC);
