-- FQ-214: GitHub workflow runs identify the checked-out source commit, while
-- repository intelligence is keyed by a scanner-derived catalog revision.
-- Preserve both identities so historical CI evidence can resolve the exact
-- policy and gate artifacts produced by that scan. A separate mapping is
-- required because multiple source commits can produce the same catalog digest.
CREATE TABLE IF NOT EXISTS fuzequality.repository_revision_sources (
  repository_id uuid NOT NULL REFERENCES fuzequality.repositories(id) ON DELETE CASCADE,
  source_revision text NOT NULL,
  catalog_revision text NOT NULL,
  scanned_at timestamptz NOT NULL,
  PRIMARY KEY (repository_id, source_revision)
);

INSERT INTO fuzequality.repository_revision_sources (
  repository_id,
  source_revision,
  catalog_revision,
  scanned_at
)
SELECT
  repository.id,
  repository.last_scan_details->>'sourceRevision',
  repository.last_scan_revision,
  COALESCE(repository.last_scan_at, now())
FROM fuzequality.repositories repository
WHERE repository.last_scan_details->>'sourceRevision' IS NOT NULL
  AND repository.last_scan_revision IS NOT NULL
ON CONFLICT (repository_id, source_revision) DO UPDATE
SET catalog_revision = EXCLUDED.catalog_revision,
    scanned_at = EXCLUDED.scanned_at;

CREATE INDEX IF NOT EXISTS repository_revision_sources_catalog_idx
  ON fuzequality.repository_revision_sources (repository_id, catalog_revision);
