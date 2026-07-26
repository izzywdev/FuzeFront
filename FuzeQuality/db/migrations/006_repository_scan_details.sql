ALTER TABLE fuzequality.repositories
  ADD COLUMN IF NOT EXISTS last_scan_details jsonb;

COMMENT ON COLUMN fuzequality.repositories.last_scan_details IS
  'Latest immutable source revision, scanner/config versions, candidate inventory, partial state, and normalized catalog counts.';
