-- FQ-210 / FQ-212: immutable scan evidence for repo-derived UX, policy, gate,
-- and performance intelligence. These rows are observations, not approved policy.
CREATE TABLE IF NOT EXISTS fuzequality.repository_quality_artifacts (
  id text PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id) ON DELETE CASCADE,
  revision text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('route','policy','gate','test-plan','load-test','stress-test')),
  title text NOT NULL,
  source_path text NOT NULL,
  summary text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository_id, revision, kind, source_path)
);

CREATE INDEX IF NOT EXISTS repository_quality_artifacts_repository_revision_idx
  ON fuzequality.repository_quality_artifacts (repository_id, revision, kind);
