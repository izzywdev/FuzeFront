-- FQ-210: support stable tenant-scoped repository analysis history pages.
CREATE INDEX IF NOT EXISTS fuzequality_repository_revisions_history_idx
  ON fuzequality.repository_revisions (
    repository_id,
    scanned_at DESC NULLS LAST,
    id DESC
  );
