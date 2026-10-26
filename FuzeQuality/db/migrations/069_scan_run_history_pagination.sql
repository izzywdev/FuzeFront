-- FQ-210: paginate repository analysis history on immutable scan-run rows.
CREATE INDEX IF NOT EXISTS fuzequality_scan_runs_history_idx
  ON fuzequality.scan_runs (
    repository_id,
    (COALESCE(finished_at, started_at)) DESC,
    id DESC
  );
