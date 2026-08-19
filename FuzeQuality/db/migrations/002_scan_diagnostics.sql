CREATE TABLE IF NOT EXISTS fuzequality.scan_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id),
  revision text NOT NULL,
  source_path text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL,
  code text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository_id, revision, source_path, code)
);

CREATE INDEX IF NOT EXISTS idx_scan_diagnostics_repository
  ON fuzequality.scan_diagnostics(repository_id, severity);
