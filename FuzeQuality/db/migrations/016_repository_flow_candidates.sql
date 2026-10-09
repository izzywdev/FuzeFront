-- FQ-202 / FQ-210: repository-derived UX flows are tenant-owned proposals.
-- They are never promoted to confirmed product behavior without human review.
CREATE TABLE IF NOT EXISTS fuzequality.repository_flow_candidates (
  id text PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  revision text NOT NULL,
  title text NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','rejected')),
  source text NOT NULL CHECK (source IN ('deterministic','litellm')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository_id, revision, title, source)
);

CREATE INDEX IF NOT EXISTS repository_flow_candidates_tenant_idx
  ON fuzequality.repository_flow_candidates (tenant_id, repository_id, status, created_at DESC);
