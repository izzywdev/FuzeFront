-- FQ-210: serve exact-revision evidence in stable ID pages to portal clients.
CREATE INDEX IF NOT EXISTS fuzequality_quality_artifacts_page_idx
  ON fuzequality.repository_quality_artifacts (repository_id, revision, id);
