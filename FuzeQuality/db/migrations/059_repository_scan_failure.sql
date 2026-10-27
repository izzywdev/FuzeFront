ALTER TABLE fuzequality.repositories
  ADD COLUMN IF NOT EXISTS last_scan_failure jsonb;

COMMENT ON COLUMN fuzequality.repositories.last_scan_failure IS
  'Sanitized terminal failure details for the latest repository scan attempt.';
