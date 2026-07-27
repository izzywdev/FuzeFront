ALTER TABLE fuzequality.repositories
  ADD COLUMN IF NOT EXISTS last_scan_revision text;
